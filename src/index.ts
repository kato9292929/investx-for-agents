/**
 * InvestX entrypoint.
 *
 * Railway always-on process: starts the HTTP server and schedules the daily
 * rebalance run via node-cron. `--run-now` triggers one run immediately.
 *
 * The x402 payment client is intentionally NOT initialised at startup. Inputs
 * come from DeFiLlama (free) + Nansen (apiKey) fetched with the plain global
 * fetch, so the agent boots with no PAYMENT_PRIVATE_KEY / SIGNER_BACKEND /
 * Circle env. The reused x402 client (src/x402.ts, src/circle/*) stays in the
 * repo untouched for the future execute path, where it will be initialised on
 * demand — never at boot.
 *
 * Execution is not wired: every run records a decision with executed:false.
 */
import "dotenv/config";
import cron from "node-cron";
import { runRebalance } from "./run";
import { startHttpServer } from "./server";

async function main(): Promise<void> {
  startHttpServer();

  // Daily at 06:00 JST (21:00 UTC) — same schedule as AA's daily run.
  cron.schedule("0 21 * * *", async () => {
    try {
      await runRebalance();
    } catch (err) {
      console.error("[AGENT] Daily rebalance run failed:", err);
    }
  });

  console.log("InvestX for Agents started");
  console.log("  Rebalance decision run: daily at 06:00 JST (21:00 UTC)");

  if (process.argv.includes("--run-now")) {
    console.log("\n[AGENT] Manual run triggered");
    await runRebalance();
  }
}

main().catch((err) => {
  console.error("[AGENT] Fatal startup error:", err);
  process.exit(1);
});
