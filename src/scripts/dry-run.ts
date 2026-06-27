/**
 * Offline verification of the decide → record path with the new sources.
 *
 * The DeFiLlama / Nansen hosts are blocked in the Claude Code sandbox (egress
 * policy), so this exercises the real mapping (buildYieldData), real holdings
 * parser, real decision engine, and real store with FIXTURE source responses
 * shaped exactly like the confirmed DeFiLlama /pools and Nansen /holdings specs.
 * No network, no payment, no execution. Real-data observation happens after a
 * Railway deploy where egress is open (TODO).
 *
 *   npm run dry-run             # MOVE candidate (smart money matched)
 *   npm run dry-run -- nosm     # Nansen unavailable → スマートマネー確認なし → HOLD
 *   npm run dry-run -- nomatch  # Nansen ok but tokens don't match → unknown → HOLD
 *   npm run dry-run -- brake    # held pool TVL collapse → EVACUATE
 *
 * Fixtures are clearly SAMPLE data, not real endpoint output.
 */
import "dotenv/config";
import { loadMandate } from "../mandate";
import { buildYieldData } from "../inputs/yield";
import { parseHoldings } from "../inputs/portfolio";
import { decideRebalance } from "../decision/rebalance";
import { resolveIdentity } from "../identity";
import { appendDecision, buildRecord, readHistory } from "../store/decision-store";
import { tvlChange24hPct, type LlamaChartPoint } from "../sources/defillama";
import type { LlamaPool } from "../sources/defillama";
import type { NansenResult } from "../sources/nansen";

// ── DeFiLlama /pools fixture (SAMPLE — Solana + a non-whitelist pool) ────────
function llamaFixture(): { ok: boolean; status: number; pools: LlamaPool[] } {
  return {
    ok: true,
    status: 200,
    pools: [
      { pool: "kamino-usdc-sol", chain: "Solana", project: "kamino", symbol: "USDC-SOL", tvlUsd: 12_000_000, apy: 9.5, apyBase: 7.0, apyReward: 2.5, underlyingTokens: ["EPjF...USDC", "So111...SOL"] },
      { pool: "drift-usdc", chain: "Solana", project: "drift", symbol: "USDC", tvlUsd: 4_000_000, apy: 5.0, apyBase: 5.0 },
      { pool: "jupiter-lend-usdc", chain: "Solana", project: "jupiter", symbol: "USDC", tvlUsd: 8_000_000, apy: 6.5, apyBase: 6.5 },
      { pool: "randomfarm-usdc", chain: "Solana", project: "somerandomfarm", symbol: "USDC", tvlUsd: 500_000, apy: 22.0 },
      { pool: "aave-usdc-eth", chain: "Ethereum", project: "aave", symbol: "USDC", tvlUsd: 99_000_000, apy: 4.0 },
    ],
  };
}

// ── Nansen /holdings fixture (SAMPLE — token granularity) ────────────────────
function nansenFixture(scenario: string): NansenResult {
  if (scenario === "nosm") {
    // Nansen unavailable (e.g. 403 tier/credit) — smart money unknown.
    return { ok: false, status: 403, holdings: [], error: "tier/credit limit" };
  }
  if (scenario === "nomatch") {
    // Nansen ok, but holdings are tokens none of our pools are composed of.
    return {
      ok: true,
      status: 200,
      holdings: [
        { chain: "solana", token_symbol: "JUP", value_usd: 5_000_000, share_of_holdings_percent: 12 },
        { chain: "solana", token_symbol: "BONK", value_usd: 1_200_000, share_of_holdings_percent: 4 },
      ],
    };
  }
  // default / brake: smart money sits in USDC and SOL.
  return {
    ok: true,
    status: 200,
    holdings: [
      { chain: "solana", token_symbol: "USDC", value_usd: 24_000_000, share_of_holdings_percent: 38 },
      { chain: "solana", token_symbol: "SOL", value_usd: 9_000_000, share_of_holdings_percent: 14 },
    ],
  };
}

function holdingsFixture(): Record<string, unknown> {
  return {
    totalValueUsd: 10_000,
    positions: [
      { protocol: "drift", poolId: "drift-usdc", pool: "USDC", valueUsd: 3_000, apy: 5.0 },
      { protocol: "jupiter", poolId: "jupiter-lend-usdc", pool: "USDC", valueUsd: 4_000, apy: 6.5 },
      { protocol: "USDC", pool: "idle", valueUsd: 3_000, apy: 0 },
    ],
  };
}

async function main(): Promise<void> {
  const scenario = process.argv[2] ?? "default";
  console.log(`\n=== InvestX dry-run (scenario: ${scenario}) ===`);
  console.log("Fixtures are SAMPLE data shaped like DeFiLlama /pools + Nansen /holdings.");
  console.log("Real hosts are egress-blocked here; real-data check is post-deploy (TODO).\n");

  const mandate = loadMandate();
  const identity = resolveIdentity();

  const yieldData = buildYieldData(llamaFixture(), nansenFixture(scenario), {
    whitelist: mandate.whitelist,
    chain: "Solana",
  });
  const portfolio = parseHoldings(holdingsFixture());

  // brake scenario: simulate the /chart-derived 24h TVL collapse on the held Drift pool.
  if (scenario === "brake") {
    const drift = yieldData.pools.find((p) => p.poolId === "drift-usdc");
    if (drift) {
      const points: LlamaChartPoint[] = [
        { timestamp: "2026-06-26T05:00:00Z", tvlUsd: 4_000_000 },
        { timestamp: "2026-06-27T05:00:00Z", tvlUsd: 2_200_000 },
      ];
      drift.tvlChange24hPct = tvlChange24hPct(points);
    }
  }

  console.log(`Yield: source=${yieldData.source}, whitelisted pools=${yieldData.pools.length}, smartMoneyConfirmed=${yieldData.smartMoneyConfirmed}`);
  console.log(`  Nansen: ${yieldData.nansen.note}`);
  for (const p of yieldData.pools) {
    console.log(`  - ${p.protocol}/${p.symbol} apy=${p.apy}% tvl=$${p.tvlUsd} | smartMoney: ${p.smartMoney.available ? `$${p.smartMoney.tokenValueUsd} (${p.smartMoney.matchedTokens.map((m) => m.symbol).join(",")})` : p.smartMoney.note}`);
  }
  console.log(`Portfolio: source=${portfolio.source}, total=$${portfolio.totalValueUsd}, positions=${portfolio.allocations.length}\n`);

  const history = readHistory();
  const decision = decideRebalance({ yield: yieldData, portfolio, mandate, history });

  console.log(`Decision: ${decision.action}`);
  console.log(`Reason:   ${decision.reason}`);
  console.log(`SmartMoney signal: ${decision.smartMoneySignal}`);
  if (decision.apyDeltaPct !== null) console.log(`APY delta: +${decision.apyDeltaPct}%`);
  if (decision.moveUsd !== null) console.log(`Move size: $${decision.moveUsd}`);
  if (decision.estimatedCost) console.log(`Est. cost: $${decision.estimatedCost.totalUsd}, projected gain: $${decision.projectedGainUsd}`);

  const record = buildRecord({
    agentId: identity.agentId,
    agentIdProvisional: identity.provisional,
    agentRegistry: identity.agentRegistry,
    decision,
    yield: yieldData,
    portfolio,
    inputCostUsdc: 0,
  });

  await appendDecision(record);
  console.log(
    `\nRecorded under agentId="${record.agentId}"${record.agentIdProvisional ? " (provisional)" : ""}, executed=${record.executed}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
