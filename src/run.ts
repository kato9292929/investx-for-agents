/**
 * One rebalance run: fetch inputs (paid via x402), parse defensively, decide,
 * record. Execution is intentionally not wired — every record is executed:false.
 *
 * This is the live path (it pays for the Yield + Portfolio endpoints). The
 * offline verification path is src/scripts/dry-run.ts, which exercises the same
 * decide → record logic with fixtures and no payment.
 */
import { callEndpoint } from "./caller";
import { YIELD_ENDPOINT, PORTFOLIO_ENDPOINT } from "./config";
import { parseYieldData } from "./inputs/yield";
import { parsePortfolioData } from "./inputs/portfolio";
import { loadMandate } from "./mandate";
import { decideRebalance } from "./decision/rebalance";
import { resolveIdentity } from "./identity";
import { appendDecision, buildRecord, readHistory } from "./store/decision-store";
import { sendBrakeNotification } from "./notify";
import type { RunLog } from "./types";
import { logRun } from "./logger";

export async function runRebalance(): Promise<void> {
  const startMs = Date.now();
  console.log("[RUN] InvestX rebalance run started");

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

  // ── Inputs (paid) ─────────────────────────────────────────────────────────
  const yieldResult = await callEndpoint(YIELD_ENDPOINT);
  const portfolioResult = await callEndpoint(PORTFOLIO_ENDPOINT);
  for (const r of [yieldResult, portfolioResult]) {
    log.results.push(r);
    log.totalCostUsdc += r.costUsdc;
    if (r.txHash) log.totalTxCount += 1;
    if (r.status === "degraded") log.totalDegradedCount += 1;
    if (r.status === "error" && r.error) log.errors.push(`${r.product}: ${r.error}`);
  }

  const yieldData = parseYieldData(yieldResult.fullData);
  const portfolio = parsePortfolioData(portfolioResult.fullData);

  if (!yieldData.smartMoneyConfirmed) {
    console.log("[RUN] スマートマネー確認なし — no positive smart-money inflow in any pool");
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
  console.log(`[RUN] Complete. $${log.totalCostUsdc.toFixed(2)} USDC spent on inputs`);
}
