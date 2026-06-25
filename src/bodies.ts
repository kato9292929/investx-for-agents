/**
 * POST request body templates keyed by endpoint id.
 *
 * Portfolio Intelligence is a POST endpoint: it analyses the allocation held by
 * a given wallet. InvestX is non-custodial — the funds live in the operator's
 * own wallet — so we ask Portfolio Intelligence to self-check that wallet via
 * INVESTX_PORTFOLIO_TARGET.
 *
 * TODO(schema): the exact request body keys for /api/portfolio/analyze are not
 * confirmed. We send { walletAddress, chain } (the shape AA used); adjust if the
 * live endpoint expects different keys.
 */
export function getRequestBody(
  endpointId: string
): Record<string, unknown> | undefined {
  const bodies: Record<string, Record<string, unknown>> = {
    "portfolio-intelligence": {
      walletAddress: process.env.INVESTX_PORTFOLIO_TARGET ?? "",
      chain: process.env.INVESTX_PORTFOLIO_CHAIN ?? "base",
    },
  };
  return bodies[endpointId];
}
