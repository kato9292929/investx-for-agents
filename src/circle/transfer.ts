/**
 * Circle Developer-Controlled Wallets — Solana USDC transfer.
 * Uses Circle's developer transaction API to send USDC on Solana.
 */
import * as crypto from "node:crypto";
import { CIRCLE_API, buildEntitySecretCiphertext, getRequiredApiKey } from "./client";

const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface SolanaTransferParams {
  walletId: string;
  destinationAddress: string;
  amountDecimal: string; // e.g. "0.200000" for 0.20 USDC
}

export interface SolanaTransferResult {
  transactionId: string;
}

export async function createSolanaTransfer(
  params: SolanaTransferParams
): Promise<SolanaTransferResult> {
  const apiKey = getRequiredApiKey();
  const entitySecretCiphertext = await buildEntitySecretCiphertext(apiKey);
  const idempotencyKey = crypto.randomUUID();

  console.log(
    `[CIRCLE:SOL] Transfer ${params.amountDecimal} USDC → ${params.destinationAddress} (idempotency: ${idempotencyKey})`
  );

  const res = await fetch(`${CIRCLE_API}/developer/transactions/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      walletId: params.walletId,
      tokenAddress: USDC_MINT_SOLANA,
      destinationAddress: params.destinationAddress,
      amounts: [params.amountDecimal],
      blockchain: "SOL",
      feeLevel: "MEDIUM",
      entitySecretCiphertext,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`[CIRCLE:SOL] transfer failed: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data: { id: string; state?: string } };
  const transactionId = json.data?.id;
  if (!transactionId) throw new Error("[CIRCLE:SOL] transfer: no transactionId in response");

  console.log(`[CIRCLE:SOL] Transfer submitted: ${transactionId}`);
  return { transactionId };
}

export async function waitForSolanaSignature(
  transactionId: string,
  maxWaitMs = 90_000,
  pollIntervalMs = 2_500
): Promise<string> {
  const apiKey = getRequiredApiKey();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${CIRCLE_API}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      const json = (await res.json()) as {
        data: { transaction: { state: string; txHash?: string } };
      };
      const tx = json.data?.transaction;

      if (tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") {
        if (!tx.txHash) throw new Error("[CIRCLE:SOL] transaction confirmed but no txHash");
        console.log(`[CIRCLE:SOL] Transaction confirmed: ${tx.txHash}`);
        return tx.txHash;
      }

      if (tx?.state === "FAILED" || tx?.state === "DENIED") {
        throw new Error(`[CIRCLE:SOL] transaction ${tx.state}: ${transactionId}`);
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`[CIRCLE:SOL] transaction timeout after ${maxWaitMs}ms: ${transactionId}`);
}
