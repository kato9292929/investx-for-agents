/**
 * DeFiLlama — yields source (no key, free).
 *
 * Spec (confirmed, do not guess):
 *   GET https://yields.llama.fi/pools
 *     -> { status, data: Pool[] }
 *     Pool: { pool, chain, project, symbol, underlyingTokens, tvlUsd, apy, apyBase, apyReward }
 *     apy is a PERCENT (12.4 = 12.4%). Only pools with TVL > 10k are listed.
 *   GET https://yields.llama.fi/chart/{pool}
 *     -> { status, data: [{ timestamp, tvlUsd, apy }] }   (for 24h TVL change)
 *
 * APY/TVL refresh hourly. We keep apy in percent throughout (the mandate APY
 * thresholds are in percent too).
 *
 * Egress note: this host may be blocked in the Claude Code sandbox. Failures
 * are returned as { ok:false, status } — never fabricated into data.
 */
const POOLS_URL = process.env.LLAMA_POOLS_URL || "https://yields.llama.fi/pools";
const CHART_BASE = process.env.LLAMA_CHART_BASE || "https://yields.llama.fi/chart";
const TIMEOUT_MS = 25_000;

export interface LlamaPool {
  pool: string; // pool id
  chain?: string;
  project?: string; // protocol slug, e.g. "kamino", "drift", "jupiter"
  symbol?: string; // composition tokens, e.g. "USDC-SOL"
  underlyingTokens?: string[];
  tvlUsd?: number;
  apy?: number; // percent
  apyBase?: number;
  apyReward?: number;
}

export interface LlamaPoolsResult {
  ok: boolean;
  status: number; // HTTP status, or 0 on transport failure
  pools: LlamaPool[];
  error?: string;
}

export interface LlamaChartPoint {
  timestamp: string;
  tvlUsd?: number;
  apy?: number;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; json?: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { status: res.status, error: `non-JSON body (HTTP ${res.status})` };
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** GET /pools. Returns every pool DeFiLlama lists (all chains); caller filters. */
export async function fetchLlamaPools(): Promise<LlamaPoolsResult> {
  console.log(`[LLAMA] GET ${POOLS_URL}`);
  const { status, json, error } = await fetchJson(POOLS_URL);
  if (status !== 200 || !json) {
    console.warn(`[LLAMA] pools fetch failed: status=${status}${error ? ` (${error})` : ""}`);
    return { ok: false, status, pools: [], error };
  }
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return { ok: false, status, pools: [], error: "response.data is not an array" };
  }
  const pools: LlamaPool[] = data.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      pool: asString(o.pool) ?? "",
      chain: asString(o.chain),
      project: asString(o.project),
      symbol: asString(o.symbol),
      underlyingTokens: Array.isArray(o.underlyingTokens)
        ? o.underlyingTokens.filter((t): t is string => typeof t === "string")
        : undefined,
      tvlUsd: asNumber(o.tvlUsd),
      apy: asNumber(o.apy),
      apyBase: asNumber(o.apyBase),
      apyReward: asNumber(o.apyReward),
    };
  });
  console.log(`[LLAMA] ${pools.length} pools received`);
  return { ok: true, status, pools };
}

/** GET /chart/{pool}. Used to compute a 24h TVL change for the brake. */
export async function fetchLlamaPoolChart(poolId: string): Promise<{ ok: boolean; status: number; points: LlamaChartPoint[] }> {
  const url = `${CHART_BASE}/${encodeURIComponent(poolId)}`;
  const { status, json } = await fetchJson(url);
  if (status !== 200 || !json) return { ok: false, status, points: [] };
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return { ok: false, status, points: [] };
  const points: LlamaChartPoint[] = data.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { timestamp: asString(o.timestamp) ?? "", tvlUsd: asNumber(o.tvlUsd), apy: asNumber(o.apy) };
  });
  return { ok: true, status, points };
}

/**
 * 24h TVL change percent from a chart series. Picks the latest point and the
 * point closest to 24h earlier. Returns undefined if it cannot be computed —
 * never a fabricated number.
 */
export function tvlChange24hPct(points: LlamaChartPoint[]): number | undefined {
  const usable = points.filter((p) => p.tvlUsd !== undefined && p.timestamp);
  if (usable.length < 2) return undefined;
  const sorted = usable
    .map((p) => ({ t: new Date(p.timestamp).getTime(), tvl: p.tvlUsd as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return undefined;
  const latest = sorted[sorted.length - 1];
  const target = latest.t - 24 * 3_600_000;
  // closest point at or before 24h ago, else the earliest available
  let prev = sorted[0];
  for (const p of sorted) {
    if (p.t <= target) prev = p;
  }
  if (prev.tvl <= 0) return undefined;
  return ((latest.tvl - prev.tvl) / prev.tvl) * 100;
}
