/**
 * InvestX entrypoint.
 *
 * Railway always-on process: starts the HTTP server, initialises x402 payment
 * (Base via Circle DCW or local key, Solana via SVM exact), and schedules the
 * daily rebalance run via node-cron — the same cron/runtime shape as
 * x402-Autonomous-Agent. `--run-now` triggers one run immediately.
 *
 * Execution is not wired: every run records a decision with executed:false.
 */
import "dotenv/config";
import cron from "node-cron";
import { runRebalance } from "./run";
import { startHttpServer } from "./server";

// Note: inputs now come from DeFiLlama (free) + Nansen (apiKey), so the x402
// payment client is not initialised on the input path. The reused x402 client
// (src/x402.ts, src/circle/*) is kept untouched for the future execute path.

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
