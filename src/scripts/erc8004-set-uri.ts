/**
 * Step 2: Set agentURI on IdentityRegistry after the agent card is live.
 *
 * Run after deploy:
 *   node dist/scripts/erc8004-set-uri.js
 *
 * Prerequisites:
 *   - INVESTX_AGENT_ID set to the id minted by erc8004-register
 *   - /.well-known/agent-card.json reachable (deployed)
 *   - CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_EVM_WALLET_ID set
 *   - Circle EVM wallet funded with ETH on Base for gas
 */
import "dotenv/config";
import { setAgentURI } from "../erc8004/executor";

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.INVESTX_PUBLIC_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
  const agentIdStr = process.env.INVESTX_AGENT_ID;
  if (!agentIdStr) throw new Error("INVESTX_AGENT_ID env var is required");
  const agentId = BigInt(agentIdStr);

  const uri = `${BASE_URL}/.well-known/agent-card.json`;

  console.log(`\n=== ERC-8004 setAgentURI (InvestX) ===`);
  console.log(`agentId: ${agentId}`);
  console.log(`uri:     ${uri}`);

  const txHash = await setAgentURI(agentId, uri);
  console.log(`\nDone. txHash=${txHash}`);
  console.log("Run erc8004-verify.js to confirm on-chain state.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
