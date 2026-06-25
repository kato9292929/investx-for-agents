/**
 * ERC-8004 contract execution via Circle Developer-Controlled Wallet.
 *
 * Uses Circle's POST /v1/w3s/developer/transactions/contractExecution API so
 * that msg.sender is the Circle EVM wallet (0xae7c...), making it the NFT owner
 * and agentWallet automatically — no setAgentWallet needed.
 *
 * After the transaction confirms, the agentId is extracted from the ERC-721
 * Transfer event (from=address(0), to=caller, tokenId=agentId).
 */
import * as crypto from "node:crypto";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { CIRCLE_API, buildEntitySecretCiphertext, getRequiredApiKey } from "../circle/client";
import { IDENTITY_REGISTRY, TRANSFER_TOPIC } from "./contract";

const publicClient = createPublicClient({ chain: base, transport: http() });

function getEvmWalletId(): string {
  const id = process.env.CIRCLE_EVM_WALLET_ID;
  if (!id) throw new Error("CIRCLE_EVM_WALLET_ID is required");
  return id;
}

interface CircleTxSubmitResponse {
  data: { id: string };
}

interface CircleTxPollResponse {
  data: { transaction: { state: string; txHash?: string } };
}

async function submitContractExecution(
  abiFunctionSignature: string,
  abiParameters: string[]
): Promise<string> {
  const apiKey = getRequiredApiKey();
  const entitySecretCiphertext = await buildEntitySecretCiphertext(apiKey);
  const idempotencyKey = crypto.randomUUID();

  const body = {
    idempotencyKey,
    walletId: getEvmWalletId(),
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature,
    abiParameters,
    feeLevel: "MEDIUM",
    entitySecretCiphertext,
  };

  console.log(`[ERC8004] Submitting contractExecution: ${abiFunctionSignature}`);

  const res = await fetch(`${CIRCLE_API}/developer/transactions/contractExecution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`[ERC8004] contractExecution submit failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as CircleTxSubmitResponse;
  const txId = json.data?.id;
  if (!txId) throw new Error("[ERC8004] contractExecution: no transaction id in response");
  console.log(`[ERC8004] Transaction submitted: ${txId}`);
  return txId;
}

async function waitForTxHash(
  txId: string,
  maxWaitMs = 120_000,
  pollIntervalMs = 3_000
): Promise<string> {
  const apiKey = getRequiredApiKey();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${CIRCLE_API}/transactions/${txId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      const json = (await res.json()) as CircleTxPollResponse;
      const tx = json.data?.transaction;

      if (tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") {
        if (!tx.txHash) throw new Error("[ERC8004] transaction confirmed but no txHash");
        console.log(`[ERC8004] Transaction confirmed: ${tx.txHash}`);
        return tx.txHash;
      }

      if (tx?.state === "FAILED" || tx?.state === "DENIED") {
        throw new Error(`[ERC8004] Transaction ${tx.state}: ${txId}`);
      }

      console.log(`[ERC8004] Waiting... state=${tx?.state ?? "unknown"}`);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`[ERC8004] Transaction timeout after ${maxWaitMs}ms: ${txId}`);
}

async function extractAgentIdFromTx(txHash: string): Promise<bigint> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  // ERC-721 mint: Transfer(from=0x000...0, to=caller, tokenId=agentId)
  // tokenId is topics[3] (3rd indexed param)
  const mintLog = receipt.logs.find(
    (l) =>
      l.topics[0] === TRANSFER_TOPIC &&
      l.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000"
  );

  if (!mintLog || !mintLog.topics[3]) {
    throw new Error(
      `[ERC8004] Transfer event not found in tx receipt. logs=${receipt.logs.length}`
    );
  }

  return BigInt(mintLog.topics[3]);
}

/** Call register() on IdentityRegistry via Circle DCW. Returns the minted agentId. */
export async function registerAgent(): Promise<bigint> {
  const txId = await submitContractExecution("register()", []);
  const txHash = await waitForTxHash(txId);
  const agentId = await extractAgentIdFromTx(txHash);
  console.log(`[ERC8004] Registered! agentId=${agentId} txHash=${txHash}`);
  return agentId;
}

/** Call setAgentURI(agentId, newURI) via Circle DCW. */
export async function setAgentURI(agentId: bigint, uri: string): Promise<string> {
  const txId = await submitContractExecution("setAgentURI(uint256,string)", [
    agentId.toString(),
    uri,
  ]);
  const txHash = await waitForTxHash(txId);
  console.log(`[ERC8004] setAgentURI done. agentId=${agentId} uri=${uri} txHash=${txHash}`);
  return txHash;
}
