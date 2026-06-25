/**
 * Step 3: Verify ERC-8004 on-chain state after registration.
 *
 * Run:
 *   node dist/scripts/erc8004-verify.js
 *
 * Prerequisites:
 *   - INVESTX_AGENT_ID set in the environment
 */
import "dotenv/config";
import { readTokenURI, readAgentWallet } from "../erc8004/reader";
import { IDENTITY_REGISTRY, AGENT_REGISTRY_ID } from "../erc8004/contract";

async function main(): Promise<void> {
  const agentIdStr = process.env.INVESTX_AGENT_ID;
  if (!agentIdStr) throw new Error("INVESTX_AGENT_ID env var is required");
  const agentId = BigInt(agentIdStr);

  console.log(`\n=== ERC-8004 Verification ===`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`agentId:          ${agentId}`);

  const [tokenURI, agentWallet] = await Promise.all([
    readTokenURI(agentId),
    readAgentWallet(agentId),
  ]);

  console.log(`\ntokenURI:    ${tokenURI}`);
  console.log(`agentWallet: ${agentWallet}`);

  const expectedWallet = process.env.CIRCLE_EVM_WALLET_ADDRESS;
  if (expectedWallet && agentWallet.toLowerCase() !== expectedWallet.toLowerCase()) {
    console.warn(`\nWARNING: agentWallet (${agentWallet}) != CIRCLE_EVM_WALLET_ADDRESS (${expectedWallet})`);
  } else if (expectedWallet) {
    console.log(`\nOK: agentWallet matches CIRCLE_EVM_WALLET_ADDRESS`);
  }

  console.log(`\nRegistry ID: ${AGENT_REGISTRY_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
