/**
 * InvestX source configuration.
 *
 * Inputs now come from primary sources directly, NOT from self-hosted Yield /
 * Portfolio Intelligence endpoints (that dependency was removed):
 *   - DeFiLlama (src/sources/defillama.ts) — apy / tvl / composition tokens
 *   - Nansen    (src/sources/nansen.ts)    — smart money (token granularity)
 *
 * The protocol whitelist lives in mandate.yaml and is read at decision time;
 * here we only fix the chain filter. URLs are configured inside each source
 * module (override via LLAMA_*_URL / NANSEN_*_URL env).
 */

// Chain filter applied to DeFiLlama pools.
export const CHAIN_FILTER = process.env.INVESTX_CHAIN || "Solana";

/**
 * EndpointConfig is retained for the reused x402 caller (src/caller.ts), which
 * is kept for the future execute path. It is no longer used for inputs.
 */
export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  cost: number;
  chain: "base" | "solana" | "polygon" | "bnb";
  captureFullData?: boolean;
}
