/**
 * Spending controls for Circle-mediated payments.
 * Enforces per-request USDC caps to prevent runaway spending.
 */

export const DEFAULT_MAX_BASE_MICRO_USDC = BigInt(3_000_000); // $3.00 (covers Mode C weekly)
export const DEFAULT_MAX_SOLANA_MICRO_USDC = BigInt(1_000_000); // $1.00

export function assertWithinSpendingLimit(
  amountMicro: bigint,
  maxMicro: bigint,
  context: string
): void {
  if (amountMicro > maxMicro) {
    throw new Error(
      `[SPENDING-CONTROL] ${context}: ${amountMicro} µUSDC exceeds limit ${maxMicro} µUSDC ($${(Number(maxMicro) / 1_000_000).toFixed(2)})`
    );
  }
}

export function getSolanaMaxMicroUsdc(): bigint {
  const env = process.env.SOLANA_MAX_USDC_MICRO;
  return env ? BigInt(env) : DEFAULT_MAX_SOLANA_MICRO_USDC;
}
