/**
 * Offline verification of the decide → record path (build step 5).
 *
 * Runs the real mandate loader, real defensive parsers, real decision engine,
 * and real append-only store — but feeds a fixture Yield/Portfolio response
 * instead of paying x402 endpoints. No payment, no network, no execution. It
 * proves that one decision lands in the InvestX store under the new agentId.
 *
 *   npm run dry-run             # default scenario (a MOVE candidate)
 *   npm run dry-run -- nosm     # no smart money → "スマートマネー確認なし"
 *   npm run dry-run -- brake    # held pool TVL collapse → EVACUATE
 *
 * The fixtures are clearly labelled samples — NOT real endpoint output. The live
 * response schema is still TODO (see src/inputs/*).
 */
import "dotenv/config";
import { loadMandate } from "../mandate";
import { parseYieldData } from "../inputs/yield";
import { parsePortfolioData } from "../inputs/portfolio";
import { decideRebalance } from "../decision/rebalance";
import { resolveIdentity } from "../identity";
import { appendDecision, buildRecord, readHistory } from "../store/decision-store";

// ── Fixture responses (SAMPLE shapes — schema is TODO, see src/inputs/*) ─────
function yieldFixture(scenario: string): Record<string, unknown> {
  if (scenario === "nosm") {
    // Whitelisted pools but no smart-money inflow reported anywhere.
    return {
      pools: [
        { protocol: "Kamino", pool: "USDC", apy: 9.5, tvlUsd: 12_000_000, tvlChange24hPct: 1.2 },
        { protocol: "Morpho", pool: "USDC", apy: 6.0, tvlUsd: 30_000_000, tvlChange24hPct: -0.3 },
      ],
    };
  }
  if (scenario === "brake") {
    // The held Drift pool's TVL has collapsed in 24h → EVACUATE.
    return {
      pools: [
        { protocol: "Drift", pool: "USDC", apy: 5.0, tvlUsd: 4_000_000, tvlChange24hPct: -42 },
        { protocol: "Kamino", pool: "USDC", apy: 9.5, tvlUsd: 12_000_000, tvlChange24hPct: 1.2, smartMoneyInflowUsd: 2_400_000 },
      ],
    };
  }
  // default: a clean MOVE candidate (Kamino, smart money in, +4.5% APY vs Drift)
  return {
    pools: [
      { protocol: "Kamino", pool: "USDC", apy: 9.5, tvlUsd: 12_000_000, tvlChange24hPct: 1.2, smartMoneyInflowUsd: 2_400_000 },
      { protocol: "Morpho", pool: "USDC", apy: 6.0, tvlUsd: 30_000_000, tvlChange24hPct: -0.3, smartMoneyInflowUsd: 0 },
      { protocol: "SomeRandomFarm", pool: "USDC", apy: 22.0, tvlUsd: 500_000, tvlChange24hPct: 4, smartMoneyInflowUsd: 999_999 },
    ],
  };
}

function portfolioFixture(): Record<string, unknown> {
  return {
    totalValueUsd: 10_000,
    positions: [
      { protocol: "Drift", pool: "USDC", valueUsd: 3_000, apy: 5.0 },
      { protocol: "Morpho", pool: "USDC", valueUsd: 4_000, apy: 6.0 },
      { protocol: "USDC", pool: "idle", valueUsd: 3_000, apy: 0 },
    ],
  };
}

async function main(): Promise<void> {
  const scenario = process.argv[2] ?? "default";
  console.log(`\n=== InvestX dry-run (scenario: ${scenario}) ===`);
  console.log("Fixtures are SAMPLE data — not real endpoint output. Schema TODO.\n");

  const mandate = loadMandate();
  const identity = resolveIdentity();

  const yieldData = parseYieldData(yieldFixture(scenario));
  const portfolio = parsePortfolioData(portfolioFixture());

  console.log(`Parsed yield pools: ${yieldData.pools.length}, smartMoneyConfirmed=${yieldData.smartMoneyConfirmed}`);
  console.log(`Parsed portfolio: total=$${portfolio.totalValueUsd}, positions=${portfolio.allocations.length}\n`);

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
    inputCostUsdc: 0, // dry-run pays nothing
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
