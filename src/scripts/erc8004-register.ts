/**
 * Step 1: Register InvestX's OWN agent with the ERC-8004 IdentityRegistry on
 * Base mainnet. This mints a NEW agentId, fully separate from
 * x402-Autonomous-Agent's 55560.
 *
 * Run after deploy:
 *   node dist/scripts/erc8004-register.js
 *
 * Prerequisites:
 *   - CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_EVM_WALLET_ID set in env
 *   - Circle EVM wallet funded with ETH on Base for gas
 *
 * Output:
 *   INVESTX_AGENT_ID=<number>
 *   Set this in your environment, then redeploy so /.well-known/agent-card.json
 *   carries the registered id. After that, run erc8004-set-uri.js.
 */
import { verifyContractExists } from "../erc8004/reader";
import { registerAgent } from "../erc8004/executor";
import { IDENTITY_REGISTRY } from "../erc8004/contract";

async function main(): Promise<void> {
  console.log(`\n=== ERC-8004 Registration ===`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY} (Base mainnet)`);

  console.log("\n[1/3] Verifying IdentityRegistry bytecode...");
  const exists = await verifyContractExists();
  if (!exists) throw new Error("IdentityRegistry has no bytecode at this address — wrong address?");
  console.log("      Contract verified.");

  console.log("\n[2/3] Calling register() via Circle DCW...");
  const agentId = await registerAgent();

  console.log("\n[3/3] Done.\n");
  console.log("=".repeat(50));
  console.log(`INVESTX_AGENT_ID=${agentId}`);
  console.log("=".repeat(50));
  console.log("\nNext steps:");
  console.log("1. Set INVESTX_AGENT_ID in your environment (Railway Variables)");
  console.log("2. Redeploy so /.well-known/agent-card.json carries the registered id");
  console.log("3. Run: node dist/scripts/erc8004-set-uri.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
