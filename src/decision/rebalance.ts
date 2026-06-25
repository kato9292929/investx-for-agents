/**
 * Rebalance decision engine.
 *
 * Pure function: given the parsed Yield + Portfolio inputs, the mandate, and a
 * small history (moves today / last move / start value), it returns exactly one
 * decision — STOP, EVACUATE, MOVE, or HOLD — with a full audit trail. It never
 * executes anything; the caller records the decision with executed:false.
 *
 * Order of checks (most protective first):
 *   1. STOP     — portfolio drawdown brake (whole-account)
 *   2. EVACUATE — a held pool's TVL collapsed in 24h
 *   3. MOVE     — a whitelisted, smart-money-backed pool clears every gate
 *   4. HOLD     — otherwise, with the reason recorded
 *
 * Every threshold comes from the mandate. Smart money is never fabricated: a
 * pool with no reported inflow is ineligible, and if nothing reports inflow the
 * decision records "スマートマネー確認なし".
 */
import type { Mandate } from "../mandate";
import { isWhitelisted } from "../mandate";
import type { YieldData, YieldPool } from "../inputs/yield";
import type { PortfolioData, Allocation } from "../inputs/portfolio";
import type {
  RebalanceDecision,
  RebalanceHistory,
  CandidateEval,
  EstimatedCost,
} from "./types";

const HOURS_PER_YEAR = 365 * 24;
const NO_SMART_MONEY = "スマートマネー確認なし";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(aIso).getTime() - new Date(bIso).getTime()) / 3_600_000;
}

/** Heuristic: is this allocation idle USDC (cash waiting), not a yield position? */
function isIdleUsdc(a: Allocation): boolean {
  const tag = `${a.protocol ?? ""} ${a.pool ?? ""}`.toLowerCase();
  const looksIdle = /usdc|idle|cash|wallet|stable/.test(tag);
  return looksIdle && (a.apy === undefined || a.apy <= 0.01);
}

/** Cheapest (lowest-APY) current placement — the leg a move would improve. */
function weakestAllocation(allocations: Allocation[]): Allocation | undefined {
  const withApy = allocations.filter((a) => a.apy !== undefined);
  const pool = withApy.length > 0 ? withApy : allocations;
  return pool
    .slice()
    .sort((a, b) => (a.apy ?? 0) - (b.apy ?? 0))[0];
}

function estimateCost(mandate: Mandate, moveUsd: number): EstimatedCost {
  const slippageUsd = moveUsd * (mandate.costEstimate.slippagePct / 100);
  const gasUsd = mandate.costEstimate.gasUsd;
  return { gasUsd, slippageUsd, totalUsd: round2(gasUsd + slippageUsd) };
}

/** Yield gain over the expected holding horizon for an APY delta, USD. */
function projectedGain(mandate: Mandate, moveUsd: number, apyDeltaPct: number): number {
  return round2(
    moveUsd * (apyDeltaPct / 100) * (mandate.move.gainHorizonHours / HOURS_PER_YEAR)
  );
}

/** Largest move into `dest` that respects pool & protocol caps, given total. */
function capRoomUsd(
  mandate: Mandate,
  dest: YieldPool,
  portfolio: PortfolioData
): number | undefined {
  const total = portfolio.totalValueUsd;
  if (total === undefined || total <= 0) return undefined;

  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/\s+/g, "");
  const destPool = norm(dest.pool);
  const destProto = norm(dest.protocol);

  const inPool = portfolio.allocations
    .filter((a) => norm(a.pool) === destPool && norm(a.protocol) === destProto)
    .reduce((s, a) => s + (a.valueUsd ?? 0), 0);
  const inProto = portfolio.allocations
    .filter((a) => norm(a.protocol) === destProto)
    .reduce((s, a) => s + (a.valueUsd ?? 0), 0);

  const poolRoom = (mandate.allocationCaps.maxPoolPct / 100) * total - inPool;
  const protoRoom = (mandate.allocationCaps.maxProtocolPct / 100) * total - inProto;
  return Math.max(0, Math.min(poolRoom, protoRoom));
}

export function decideRebalance(inputs: {
  yield: YieldData;
  portfolio: PortfolioData;
  mandate: Mandate;
  history: RebalanceHistory;
}): RebalanceDecision {
  const { yield: yieldData, portfolio, mandate, history } = inputs;
  const evaluated: CandidateEval[] = [];

  const base: RebalanceDecision = {
    action: "HOLD",
    reason: "",
    smartMoneySignal: yieldData.smartMoneyConfirmed ? "" : NO_SMART_MONEY,
    apyDeltaPct: null,
    moveUsd: null,
    estimatedCost: null,
    projectedGainUsd: null,
    evaluated,
  };

  // ── 1. STOP brake — whole-account drawdown ───────────────────────────────
  if (
    portfolio.totalValueUsd !== undefined &&
    history.startValueUsd !== undefined &&
    history.startValueUsd > 0
  ) {
    const drawdownPct = ((portfolio.totalValueUsd - history.startValueUsd) / history.startValueUsd) * 100;
    if (drawdownPct <= -mandate.brakes.portfolioDrawdownPct) {
      return {
        ...base,
        action: "STOP",
        reason:
          `全体評価額 $${round2(portfolio.totalValueUsd)} が開始比 ${round2(drawdownPct)}% ` +
          `(<= -${mandate.brakes.portfolioDrawdownPct}%) — 全停止＋通知`,
      };
    }
  }

  // ── 2. EVACUATE brake — a held pool's TVL collapsed in 24h ────────────────
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/\s+/g, "");
  for (const held of portfolio.allocations) {
    const match = yieldData.pools.find(
      (p) => norm(p.pool) === norm(held.pool) && norm(p.protocol) === norm(held.protocol)
    );
    if (
      match?.tvlChange24hPct !== undefined &&
      match.tvlChange24hPct <= -mandate.brakes.poolTvlDrop24hPct
    ) {
      return {
        ...base,
        action: "EVACUATE",
        reason:
          `保有プール ${held.protocol ?? "?"}/${held.pool ?? "?"} の TVL が 24h で ` +
          `${round2(match.tvlChange24hPct)}% (<= -${mandate.brakes.poolTvlDrop24hPct}%) — 退避`,
        from: { protocol: held.protocol, pool: held.pool, valueUsd: held.valueUsd, apy: held.apy },
        smartMoneySignal: base.smartMoneySignal,
      };
    }
  }

  // ── 3. MOVE evaluation ────────────────────────────────────────────────────
  if (mandate.move.requireSmartMoney && !yieldData.smartMoneyConfirmed) {
    return {
      ...base,
      reason: "どの候補プールにもスマートマネー流入が確認できず — 移動しない",
      smartMoneySignal: NO_SMART_MONEY,
    };
  }

  const reference = weakestAllocation(portfolio.allocations);
  const referenceApy = reference?.apy ?? 0; // idle USDC ≈ 0% if no positions

  // Candidate pool = whitelisted, (smart money present if required), APY known.
  let best:
    | { pool: YieldPool; apyDeltaPct: number; moveUsd: number; cost: EstimatedCost; gain: number }
    | undefined;

  for (const p of yieldData.pools) {
    const whitelisted = isWhitelisted(mandate, p.protocol);
    const smInflow = p.smartMoneyInflowUsd;
    const hasSmart = smInflow !== undefined && smInflow > 0;
    const apyDelta = p.apy !== undefined ? round2(p.apy - referenceApy) : undefined;

    if (!whitelisted) {
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: false, verdict: "rejected", note: "whitelist 外" });
      continue;
    }
    if (mandate.move.requireSmartMoney && !hasSmart) {
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "rejected", note: NO_SMART_MONEY });
      continue;
    }
    if (apyDelta === undefined || apyDelta < mandate.move.apyImprovementMinPct) {
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "rejected", note: `APY 差 ${apyDelta ?? "?"}% < +${mandate.move.apyImprovementMinPct}%` });
      continue;
    }

    // Size the move: source value, clamped by destination caps.
    const sourceUsd = reference?.valueUsd ?? portfolio.totalValueUsd;
    if (sourceUsd === undefined) {
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "rejected", note: "移動元の評価額不明（ポートフォリオ未取得）" });
      continue;
    }
    // Keep >= min_usdc_idle_pct in idle USDC when the source IS idle USDC.
    let maxFromSource = sourceUsd;
    let idleLimited = false;
    if (reference && isIdleUsdc(reference) && portfolio.totalValueUsd !== undefined) {
      const minIdleUsd = (mandate.allocationCaps.minUsdcIdlePct / 100) * portfolio.totalValueUsd;
      maxFromSource = Math.max(0, (reference.valueUsd ?? 0) - minIdleUsd);
      idleLimited = maxFromSource < sourceUsd;
    }

    const room = capRoomUsd(mandate, p, portfolio);
    const moveUsd = round2(room === undefined ? maxFromSource : Math.min(maxFromSource, room));

    if (moveUsd < mandate.move.minMoveUsd) {
      const why =
        idleLimited && maxFromSource < mandate.move.minMoveUsd
          ? `USDC 待機下限 (${mandate.allocationCaps.minUsdcIdlePct}%) に到達`
          : room !== undefined && room < mandate.move.minMoveUsd
            ? "配分上限に到達"
            : `移動額 $${moveUsd} < 下限 $${mandate.move.minMoveUsd}`;
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "rejected", note: why });
      continue;
    }

    const cost = estimateCost(mandate, moveUsd);
    const gain = projectedGain(mandate, moveUsd, apyDelta);
    if (mandate.move.costMustBeBelowGain && cost.totalUsd >= gain) {
      evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "rejected", note: `コスト $${cost.totalUsd} >= 見込み利得 $${gain}（${mandate.move.gainHorizonHours}h）` });
      continue;
    }

    evaluated.push({ ...mini(p), apyDeltaPct: apyDelta, whitelisted: true, verdict: "selected", note: "全ゲート通過（候補）" });
    if (!best || apyDelta > best.apyDeltaPct) {
      best = { pool: p, apyDeltaPct: apyDelta, moveUsd, cost, gain };
    }
  }

  if (!best) {
    return {
      ...base,
      reason: "全ゲートを通過する候補なし — 移動しない",
    };
  }

  // ── Frequency / hold-time gates (apply once a candidate exists) ───────────
  const nowIso = new Date().toISOString();
  if (history.movesToday >= mandate.move.maxMovesPerDay) {
    return {
      ...base,
      reason: `本日の移動回数が上限 (${mandate.move.maxMovesPerDay}) に到達 — 見送り`,
      smartMoneySignal: smartSignalText(best.pool),
      apyDeltaPct: best.apyDeltaPct,
      to: mini(best.pool),
    };
  }
  if (history.lastMoveAt && hoursBetween(nowIso, history.lastMoveAt) < mandate.move.minHoldHours) {
    const held = round2(hoursBetween(nowIso, history.lastMoveAt));
    return {
      ...base,
      reason: `直近の移動から ${held}h（最低保有 ${mandate.move.minHoldHours}h 未満）— 見送り`,
      smartMoneySignal: smartSignalText(best.pool),
      apyDeltaPct: best.apyDeltaPct,
      to: mini(best.pool),
    };
  }

  return {
    action: "MOVE",
    reason:
      `${best.pool.protocol}/${best.pool.pool} へ移動 — APY 差 +${best.apyDeltaPct}% ` +
      `(基準 ${round2(referenceApy)}% → ${best.pool.apy}%)、見込み利得 $${best.gain} > コスト $${best.cost.totalUsd}`,
    smartMoneySignal: smartSignalText(best.pool),
    apyDeltaPct: best.apyDeltaPct,
    from: reference
      ? { protocol: reference.protocol, pool: reference.pool, valueUsd: reference.valueUsd, apy: reference.apy }
      : undefined,
    to: mini(best.pool),
    moveUsd: best.moveUsd,
    estimatedCost: best.cost,
    projectedGainUsd: best.gain,
    evaluated,
  };
}

function mini(p: YieldPool): Pick<YieldPool, "protocol" | "pool" | "apy" | "smartMoneyInflowUsd"> {
  return { protocol: p.protocol, pool: p.pool, apy: p.apy, smartMoneyInflowUsd: p.smartMoneyInflowUsd };
}

function smartSignalText(p: YieldPool): string {
  if (p.smartMoneyInflowUsd === undefined) return NO_SMART_MONEY;
  return `${p.protocol ?? "?"}/${p.pool ?? "?"} スマートマネー流入 $${round2(p.smartMoneyInflowUsd)}`;
}
