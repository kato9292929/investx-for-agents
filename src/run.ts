/**
 * One rebalance run: pull inputs from primary sources (DeFiLlama + Nansen),
 * map smart money to pools, decide, record. Execution is not wired — every
 * record is executed:false.
 *
 * Inputs no longer go through the self-hosted Yield / Portfolio Intelligence
 * endpoints. DeFiLlama is free (no payment); Nansen uses apiKey auth (its own
 * credit/x402 billing, handled by the key — no x402 signing here). The reused
 * x402 payment client is untouched and kept for the future execute path.
 */
import { fetchLlamaPools, fetchLlamaPoolChart, tvlChange24hPct } from "./sources/defillama";
import { fetchNansenHoldings } from "./sources/nansen";
import { buildYieldData, type YieldData } from "./inputs/yield";
import { loadHoldings, type PortfolioData } from "./inputs/portfolio";
import { CHAIN_FILTER } from "./config";
import { loadMandate } from "./mandate";
import { decideRebalance } from "./decision/rebalance";
import { resolveIdentity } from "./identity";
import { appendDecision, buildRecord, readHistory } from "./store/decision-store";
import { sendBrakeNotification } from "./notify";
import type { RunLog, EndpointResult } from "./types";
import { logRun } from "./logger";

/**
 * Best-effort: attach a 24h TVL change to held pools via DeFiLlama /chart, so
 * the TVL brake can be evaluated. Only held pools with a poolId are queried.
 * Failures leave tvlChange24hPct undefined (the engine treats it as unknown).
 */
async function enrichHeldPoolTvl(yieldData: YieldData, portfolio: PortfolioData): Promise<void> {
  const heldPoolIds = new Set(
    portfolio.allocations.map((a) => a.poolId).filter((id): id is string => !!id)
  );
  for (const pool of yieldData.pools) {
    if (!pool.poolId || !heldPoolIds.has(pool.poolId)) continue;
    try {
      const chart = await fetchLlamaPoolChart(pool.poolId);
      if (chart.ok) pool.tvlChange24hPct = tvlChange24hPct(chart.points);
    } catch {
      // leave undefined — unknown, not fabricated
    }
  }
}

function sourceResult(
  product: string,
  endpoint: string,
  ok: boolean,
  status: number,
  peek: string,
  error: string | undefined,
  durationMs: number
): EndpointResult {
  return {
    endpoint,
    product,
    status: ok ? "success" : "error",
    costUsdc: 0, // DeFiLlama free; Nansen billed via its own key, not x402 here
    responsePeek: peek,
    error,
    durationMs,
  };
}

export async function runRebalance(): Promise<void> {
  const startMs = Date.now();
  console.log("[RUN] InvestX rebalance run started (sources: DeFiLlama + Nansen)");

  const mandate = loadMandate();
  const identity = resolveIdentity();
  if (identity.provisional) {
    console.warn(
      `[RUN] Using PROVISIONAL agentId "${identity.agentId}" — register ERC-8004 and set INVESTX_AGENT_ID. (TODO)`
    );
  }

  const log: RunLog = {
    timestamp: new Date().toISOString(),
    mode: "rebalance",
    results: [],
    totalCostUsdc: 0,
    totalTxCount: 0,
    totalDegradedCount: 0,
    durationMs: 0,
    errors: [],
  };

  // ── Inputs from primary sources ───────────────────────────────────────────
  const tLlama = Date.now();
  const llama = await fetchLlamaPools();
  log.results.push(
    sourceResult(
      "DeFiLlama /pools",
      "https://yields.llama.fi/pools",
      llama.ok,
      llama.status,
      `pools=${llama.pools.length}`,
      llama.error,
      Date.now() - tLlama
    )
  );
  if (!llama.ok) log.errors.push(`DeFiLlama: status=${llama.status}${llama.error ? ` ${llama.error}` : ""}`);

  const tNansen = Date.now();
  const nansen = await fetchNansenHoldings();
  log.results.push(
    sourceResult(
      "Nansen smart-money/holdings",
      "https://api.nansen.ai/api/v1/smart-money/holdings",
      nansen.ok,
      nansen.status,
      `holdings=${nansen.holdings.length}`,
      nansen.error,
      Date.now() - tNansen
    )
  );
  if (!nansen.ok) log.errors.push(`Nansen: status=${nansen.status}${nansen.error ? ` ${nansen.error}` : ""}`);

  const yieldData = buildYieldData(llama, nansen, { whitelist: mandate.whitelist, chain: CHAIN_FILTER });
  const portfolio = loadHoldings();

  await enrichHeldPoolTvl(yieldData, portfolio);

  if (!yieldData.smartMoneyConfirmed) {
    console.log("[RUN] スマートマネー確認なし — no matched composition token has smart-money holdings");
  }
  if (!portfolio.available) {
    console.log(`[RUN] 現在配置 不明 — ${portfolio.note ?? "holdings unavailable"}`);
  }

  // ── Decide (records executed:false; no funds move) ────────────────────────
  const history = readHistory();
  const decision = decideRebalance({ yield: yieldData, portfolio, mandate, history });

  const record = buildRecord({
    agentId: identity.agentId,
    agentIdProvisional: identity.provisional,
    agentRegistry: identity.agentRegistry,
    decision,
    yield: yieldData,
    portfolio,
    inputCostUsdc: log.totalCostUsdc,
  });

  try {
    await appendDecision(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.errors.push(`Decision store: ${msg}`);
    console.error(`[RUN] Failed to persist decision: ${msg}`);
  }

  console.log(
    `[RUN] Decision — ${decision.action} | ${decision.reason} ` +
      `[agentId=${identity.agentId}${identity.provisional ? " (provisional)" : ""}, executed=false]`
  );

  if (decision.action === "STOP" || decision.action === "EVACUATE") {
    await sendBrakeNotification(decision.action, decision.reason);
  }

  log.durationMs = Date.now() - startMs;
  logRun(log);
  console.log(`[RUN] Complete. Inputs: DeFiLlama(${llama.status}) Nansen(${nansen.status}); $0 x402 spent`);
}
