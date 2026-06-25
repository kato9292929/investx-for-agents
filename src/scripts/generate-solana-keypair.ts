/**
 * Generate a Solana keypair for SOLANA_PRIVATE_KEY env var.
 *
 * Run in Railway Console:
 *   node dist/scripts/generate-solana-keypair.js
 *
 * Output (add both to Railway Variables):
 *   SOLANA_PRIVATE_KEY=<base58 64-byte keypair>
 *   SOLANA_WALLET_ADDRESS=<public address>
 */
import { generateKeyPair, createSignerFromKeyPair } from "@solana/kit";
import { base58 } from "@scure/base";

async function main(): Promise<void> {
  const keyPair = await generateKeyPair();
  const signer = await createSignerFromKeyPair(keyPair);

  const privRaw = await crypto.subtle.exportKey("raw", keyPair.privateKey);
  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const full64 = Buffer.concat([Buffer.from(privRaw), Buffer.from(pubRaw)]);

  console.log("\n=== Solana keypair generated ===");
  console.log(`SOLANA_PRIVATE_KEY=${base58.encode(full64)}`);
  console.log(`SOLANA_WALLET_ADDRESS=${signer.address}`);
  console.log("\nAdd both to Railway Variables.");
  console.log(`Send USDC (Solana mainnet) to: ${signer.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
