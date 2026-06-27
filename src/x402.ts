/**
 * x402 fetch initialization for Base (EVM) and Solana payments.
 *
 * EVM signing backend (SIGNER_BACKEND):
 *   "circle"     — Circle Developer-Controlled Wallet (CIRCLE_EVM_WALLET_ID + CIRCLE_EVM_WALLET_ADDRESS)
 *   "privatekey" — Local EOA private key (PAYMENT_PRIVATE_KEY)  ← default
 *
 * Solana signing: native keypair from SOLANA_PRIVATE_KEY (base58-encoded 64-byte keypair).
 * SOLANA_PRIVATE_KEY is optional — if absent, Solana endpoints are skipped.
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentRequirements } from "@x402/core/types";
import { getCircleEvmSignerFromEnv } from "./circle/evm-signer";
import { DEFAULT_MAX_BASE_MICRO_USDC } from "./circle/spending-controls";

let _fetchWithPayment:
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | null = null;

function buildEvmScheme(): ExactEvmScheme {
  const backend = process.env.SIGNER_BACKEND ?? "privatekey";

  if (backend === "circle") {
    console.log("[X402] Using Circle DCW signer for Base (SIGNER_BACKEND=circle)");
    const signer = getCircleEvmSignerFromEnv();
    console.log(`[X402] Circle EVM wallet: ${signer.address}`);
    return new ExactEvmScheme(signer);
  }

  const privateKey = process.env.PAYMENT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "PAYMENT_PRIVATE_KEY is required when SIGNER_BACKEND=privatekey (default). " +
      "Set SIGNER_BACKEND=circle to use Circle DCW instead."
    );
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`[X402] Using private key signer for Base: ${account.address}`);
  return new ExactEvmScheme(toClientEvmSigner(account));
}

/** True iff an EVM signer is configured (private key, or Circle wallet env). */
function hasEvmSignerConfigured(): boolean {
  const backend = process.env.SIGNER_BACKEND ?? "privatekey";
  if (backend === "circle") {
    return Boolean(process.env.CIRCLE_EVM_WALLET_ID && process.env.CIRCLE_EVM_WALLET_ADDRESS);
  }
  return Boolean(process.env.PAYMENT_PRIVATE_KEY);
}

/**
 * Initialise the x402 payment fetch wrapper. This is for the future execute
 * path ONLY — InvestX inputs (DeFiLlama/Nansen) use the plain global fetch and
 * never call this. It is intentionally NOT invoked at startup.
 *
 * Defensive guard: if no signer is configured it logs and returns instead of
 * throwing, so the process can never crash at boot over a missing payment key
 * (even if some stale build were to call it). When execute is wired, call this
 * only after confirming a signer is present.
 */
export async function initX402Fetch(): Promise<void> {
  if (!hasEvmSignerConfigured()) {
    console.warn(
      "[X402] No EVM signer configured (PAYMENT_PRIVATE_KEY / SIGNER_BACKEND=circle). " +
        "x402 payment left uninitialised — inputs do not need it; the execute path will."
    );
    return;
  }

  const evmScheme = buildEvmScheme();
  const maxUsdc = DEFAULT_MAX_BASE_MICRO_USDC;

  const client = new x402Client()
    .register("eip155:8453", evmScheme)
    .registerV1("base", evmScheme)
    .registerPolicy(
      (_version: number, reqs: PaymentRequirements[]) =>
        reqs.filter((r) => {
          try {
            return BigInt(r.amount) <= maxUsdc;
          } catch {
            return false;
          }
        })
    );

  // Solana: register SVM scheme if SOLANA_PRIVATE_KEY is set
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (solanaPrivateKey) {
    // SOLANA_PRIVATE_KEY: base58-encoded 64-byte keypair (32-byte seed + 32-byte pubkey)
    const keyBytes = base58.decode(solanaPrivateKey);
    const svmSigner = await createKeyPairSignerFromBytes(keyBytes);
    registerExactSvmScheme(client, { signer: svmSigner });
    console.log(`[X402] Solana SVM scheme registered (address: ${svmSigner.address})`);
  } else {
    console.log("[X402] SOLANA_PRIVATE_KEY not set — Solana endpoints will be skipped");
  }

  _fetchWithPayment = wrapFetchWithPayment(fetch, client);
}

export function fetchWithPayment(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!_fetchWithPayment) {
    throw new Error("x402 fetch not initialized. Call initX402Fetch() first.");
  }
  return _fetchWithPayment(input, init);
}
