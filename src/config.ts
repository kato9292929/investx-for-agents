/**
 * InvestX input endpoints.
 *
 * Only two x402 endpoints feed the rebalance decision:
 *   - Yield Intelligence    … candidate-pool APY + Nansen smart-money inflow
 *   - Portfolio Intelligence … self-check of the current allocation
 *
 * URLs and 402 costs are copied from x402-Autonomous-Agent's live config
 * (src/config.ts) so the payment requirements match the real endpoints. The
 * APAC Macro endpoint that AA used is intentionally NOT included (out of scope).
 *
 * captureFullData is true on both: the decision engine parses the full body.
 *
 * TODO(schema): the live response shapes for these endpoints could not be
 * confirmed from this environment (the Vercel hosts are out of egress scope).
 * Parsing is defensive (src/inputs/*) and the schemas are documented as TODO.
 */
const getEnvOrDefault = (envName: string, defaultUrl: string): string =>
  process.env[envName] || defaultUrl;

export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  cost: number;
  chain: "base" | "solana" | "polygon" | "bnb";
  captureFullData?: boolean;
}

export const YIELD_ENDPOINT: EndpointConfig = {
  id: "yield-intelligence",
  name: "Yield Intelligence",
  url: getEnvOrDefault("YIELD_INTELLIGENCE_URL", "https://x402yi.vercel.app/api/yield/scan"),
  method: "GET",
  cost: 0.2,
  chain: "base",
  captureFullData: true,
};

export const PORTFOLIO_ENDPOINT: EndpointConfig = {
  id: "portfolio-intelligence",
  name: "Portfolio Intelligence",
  url: getEnvOrDefault("PORTFOLIO_INTELLIGENCE_URL", "https://x402pi.vercel.app/api/portfolio/analyze"),
  method: "POST",
  cost: 0.5,
  chain: "base",
  captureFullData: true,
};

export const INPUT_ENDPOINTS: EndpointConfig[] = [YIELD_ENDPOINT, PORTFOLIO_ENDPOINT];
