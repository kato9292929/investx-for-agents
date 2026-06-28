/**
 * Execution config (Kamino in-wallet rebalance).
 *
 * All execution is OFF by default. EXECUTE_ENABLED must be explicitly "true" to
 * send a real mainnet transaction; otherwise the path stops after simulate.
 *
 * v1 scope: move USDC between two Kamino Earn vaults the wallet already owns
 * (no external transfer, no Drift/Jupiter execution).
 */

/** Hard safety switch. Only "true" allows a real mainnet send. */
export const EXECUTE_ENABLED = process.env.EXECUTE_ENABLED === "true";

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;

/** Source / destination Kamino vault addresses (the wallet's own positions). */
export const KAMINO_FROM_VAULT = process.env.KAMINO_FROM_VAULT;
export const KAMINO_TO_VAULT = process.env.KAMINO_TO_VAULT;

/** Amount to move, in USDC (minimal $1 for the first real send). */
export const KAMINO_MOVE_USD = Number(process.env.KAMINO_MOVE_USD ?? "1");

/** Approx Solana slot duration; used by klend for slot-based math. */
export const SLOT_DURATION_MS = Number(process.env.SOLANA_SLOT_MS ?? "450");

/** USDC mint on Solana mainnet (reference; vaults are USDC-denominated). */
export const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** True only when both vault addresses are configured (execution can be attempted). */
export function executionConfigured(): boolean {
  return Boolean(SOLANA_RPC_URL && KAMINO_FROM_VAULT && KAMINO_TO_VAULT);
}
