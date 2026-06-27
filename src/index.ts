/**
 * InvestX entrypoint.
 *
 * Railway always-on process: starts the HTTP server and schedules the daily
 * rebalance run via node-cron. `--run-now` triggers one run immediately.
 *
 * There are no payment/signing dependencies. Inputs come from DeFiLlama (free)
 * and Nansen (apiKey header) over the plain global fetch, so the agent boots
 * with no wallet keys — a missing key can never crash startup.
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
