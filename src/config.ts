/**
 * InvestX source configuration.
 *
 * Inputs come from primary sources directly:
 *   - DeFiLlama (src/sources/defillama.ts) — apy / tvl / composition tokens
 *   - Nansen    (src/sources/nansen.ts)    — smart money (token granularity)
 *
 * The protocol whitelist lives in mandate.yaml and is read at decision time;
 * here we only fix the chain filter. There are no payment/signing settings:
 * DeFiLlama is free and Nansen uses an apiKey header — no payment, no wallet keys.
 */

// Chain filter applied to DeFiLlama pools.
export const CHAIN_FILTER = process.env.INVESTX_CHAIN || "Solana";
