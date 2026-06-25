/**
 * Detects stub / fallback / degraded responses from paid endpoints.
 *
 * x402 pays before the response arrives, so we cannot avoid paying for stubs.
 * This module identifies them after the fact so they can be tracked separately
 * from genuine successes — giving a signal to remove persistently-stub endpoints.
 */

export interface DegradedResult {
  degraded: true;
  reason: string;
}

export interface OkResult {
  degraded: false;
}

export type DetectionResult = DegradedResult | OkResult;

// Fake tx_hash: Ethereum 0x + fewer than 64 hex chars, or Solana-like but too short
const FAKE_ETH_TX_HASH = /^0x[0-9a-fA-F]{3,62}$/;

function isFakeTxHash(val: unknown): boolean {
  if (typeof val !== "string") return false;
  return FAKE_ETH_TX_HASH.test(val);
}

function checkNestedFakeTxHash(data: Record<string, unknown>): string | null {
  for (const key of ["tx_hash", "txHash", "transaction_hash", "transactionHash"]) {
    const val = data[key];
    if (isFakeTxHash(val)) return `fake ${key}=${String(val)}`;
  }
  return null;
}

export function detectDegraded(data: Record<string, unknown>): DetectionResult {
  // Explicit stub/fallback markers
  if (data["source"] === "sample-data") {
    return { degraded: true, reason: "source=sample-data" };
  }
  if (data["dataMode"] === "fallback") {
    return { degraded: true, reason: "dataMode=fallback" };
  }
  if (data["mock"] === true) {
    return { degraded: true, reason: "mock=true" };
  }
  if (data["isMock"] === true) {
    return { degraded: true, reason: "isMock=true" };
  }
  if (typeof data["status"] === "string" && data["status"] === "stub") {
    return { degraded: true, reason: "status=stub" };
  }

  // Fake tx_hash in the response body (not the payment header — that's handled separately)
  const fakeTx = checkNestedFakeTxHash(data);
  if (fakeTx) return { degraded: true, reason: fakeTx };

  // Nested data object that itself has stub markers
  if (data["data"] !== null && typeof data["data"] === "object" && !Array.isArray(data["data"])) {
    const nested = data["data"] as Record<string, unknown>;
    return detectDegraded(nested);
  }

  return { degraded: false };
}
