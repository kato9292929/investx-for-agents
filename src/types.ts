// EndpointConfig is defined in config.ts.
//
// Carried over from x402-Autonomous-Agent so the generic caller (src/caller.ts)
// can stay byte-for-byte identical. InvestX adds `fullData` capture on every
// input endpoint because the rebalance decision needs the parsed response, not
// just a peek.
export interface EndpointResult {
  endpoint: string;
  product: string;
  status: "success" | "degraded" | "error";
  costUsdc: number;
  responsePeek: string;
  txHash?: string;
  error?: string;
  degradedReason?: string;
  durationMs: number;
  fullData?: Record<string, unknown>;
}

export interface RunLog {
  timestamp: string;
  mode: "rebalance";
  results: EndpointResult[];
  totalCostUsdc: number;
  totalTxCount: number;
  totalDegradedCount: number;
  durationMs: number;
  errors: string[];
}
