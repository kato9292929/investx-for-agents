/**
 * Solana signer for InvestX execution.
 *
 * Loads the EXISTING wallet (6JKV...) from SOLANA_KEYPAIR and converts it to a
 * @solana/kit KeyPairSigner. It NEVER generates a new keypair — generating one
 * (e.g. generateKeyPairSigner) would sign with the wrong wallet. As a hard
 * safety check, the loaded address must equal EXPECTED_WALLET or startup fails.
 *
 * SOLANA_KEYPAIR format: the solana CLI id.json — a JSON array of 64 bytes
 * (32-byte seed + 32-byte public key), the same bytes file `solana-keygen`
 * writes. Example: "[12,34,...]". Exactly @solana/kit's
 * createKeyPairSignerFromBytes input.
 */
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

/** The only wallet this agent is allowed to sign for. */
export const EXPECTED_WALLET = "6JKVugbVRXR92sacDzgxBU6k6Mb9AAhxLbEy3DyWvEzA";

function parseKeypairBytes(raw: string): Uint8Array {
  const t = raw.trim();
  if (!t.startsWith("[")) {
    throw new Error(
      "SOLANA_KEYPAIR must be a JSON byte array (solana id.json format: 64 numbers)."
    );
  }
  let arr: unknown;
  try {
    arr = JSON.parse(t);
  } catch {
    throw new Error("SOLANA_KEYPAIR is not valid JSON");
  }
  if (!Array.isArray(arr) || !arr.every((n) => typeof n === "number")) {
    throw new Error("SOLANA_KEYPAIR is not a numeric JSON array");
  }
  return Uint8Array.from(arr as number[]);
}

/**
 * Load and verify the signer. Throws (fatal) if SOLANA_KEYPAIR is missing,
 * malformed, or resolves to any address other than EXPECTED_WALLET.
 */
export async function loadInvestxSigner(): Promise<KeyPairSigner> {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error("SOLANA_KEYPAIR is required to load the Solana signer");

  const bytes = parseKeypairBytes(raw);
  if (bytes.length !== 64) {
    throw new Error(
      `SOLANA_KEYPAIR must be 64 bytes (got ${bytes.length}). ` +
        "Use the solana id.json keypair, not a 32-byte secret."
    );
  }

  const signer = await createKeyPairSignerFromBytes(bytes);

  if (signer.address !== EXPECTED_WALLET) {
    throw new Error(
      `[SAFETY] SOLANA_KEYPAIR resolves to ${signer.address}, expected ${EXPECTED_WALLET}. ` +
        "Refusing to run to avoid signing with the wrong wallet."
    );
  }

  console.log(`[SOLANA] signer loaded and verified: ${signer.address}`);
  return signer;
}
