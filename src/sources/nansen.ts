/**
 * Nansen — smart-money source (apiKey required).
 *
 * Spec (confirmed, do not guess):
 *   POST https://api.nansen.ai/api/v1/smart-money/holdings
 *   headers: { apiKey: <NANSEN_API_KEY>, Content-Type: application/json }
 *   body:
 *     chains: ["solana"]
 *     filters: { include_smart_money_labels: ["Fund","Smart Trader"],
 *                include_stablecoins: true, include_native_tokens: true }
 *     order_by: [{ field: "value_usd", direction: "DESC" }]
 *     pagination: { page: 1, per_page: 100 }
 *   -> { data: Holding[], pagination }
 *     Holding: { chain, token_address, token_symbol, token_sectors, value_usd,
 *                balance_24h_percent_change, holders_count,
 *                share_of_holdings_percent, market_cap_usd }
 *
 * Granularity (confirmed): holdings are per TOKEN — not per pool, not per
 * protocol. The caller maps token value to a pool via the pool's composition
 * tokens, and must not claim pool-level smart money.
 *
 * Auth/billing errors are surfaced with their status (401 invalid key, 402
 * MPP payment-required, 403 tier/credit, 429 rate). The key and raw body
 * are never logged; credit headers are logged.
 *
 * Egress note: this host may be blocked in the Claude Code sandbox. Failures are
 * returned as { ok:false, status } — never fabricated into data.
 */
const HOLDINGS_URL =
  process.env.NANSEN_HOLDINGS_URL || "https://api.nansen.ai/api/v1/smart-money/holdings";
const TIMEOUT_MS = 25_000;

export interface NansenHolding {
  chain?: string;
  token_address?: string;
  token_symbol?: string;
  token_sectors?: string[];
  value_usd?: number; // smart-money holding USD for this token
  balance_24h_percent_change?: number;
  holders_count?: number;
  share_of_holdings_percent?: number;
  market_cap_usd?: number;
}

export interface NansenResult {
  ok: boolean;
  status: number; // HTTP status, or 0 on transport failure / missing key
  holdings: NansenHolding[];
  creditsUsed?: string;
  creditsRemaining?: string;
  error?: string; // short reason (never the raw body or key)
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function buildHoldingsBody(): Record<string, unknown> {
  return {
    chains: ["solana"],
    filters: {
      include_smart_money_labels: ["Fund", "Smart Trader"],
      include_stablecoins: true,
      include_native_tokens: true,
    },
    order_by: [{ field: "value_usd", direction: "DESC" }],
    pagination: { page: 1, per_page: 100 },
  };
}

/** POST /smart-money/holdings. Returns token-granularity smart-money holdings. */
export async function fetchNansenHoldings(): Promise<NansenResult> {
  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) {
    console.warn("[NANSEN] NANSEN_API_KEY not set — smart money will be recorded as unknown");
    return { ok: false, status: 0, holdings: [], error: "NANSEN_API_KEY not set" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    console.log(`[NANSEN] POST ${HOLDINGS_URL} (chains=["solana"])`);
    const res = await fetch(HOLDINGS_URL, {
      method: "POST",
      headers: { apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(buildHoldingsBody()),
      signal: controller.signal,
    });

    const creditsUsed = res.headers.get("X-Nansen-Credits-Used") ?? undefined;
    const creditsRemaining = res.headers.get("X-Nansen-Credits-Remaining") ?? undefined;
    if (creditsUsed || creditsRemaining) {
      console.log(`[NANSEN] credits used=${creditsUsed ?? "?"} remaining=${creditsRemaining ?? "?"}`);
    }

    if (res.status !== 200) {
      // Map the known auth/billing statuses to a short, key-free reason.
      const reason =
        res.status === 401
          ? "invalid key"
          : res.status === 402
            ? "payment required (MPP)"
            : res.status === 403
              ? "tier/credit limit"
              : res.status === 429
                ? "rate limited"
                : `HTTP ${res.status}`;
      console.warn(`[NANSEN] holdings non-200: status=${res.status} (${reason})`);
      return { ok: false, status: res.status, holdings: [], creditsUsed, creditsRemaining, error: reason };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, status: res.status, holdings: [], creditsUsed, creditsRemaining, error: "non-JSON body" };
    }

    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return { ok: false, status: res.status, holdings: [], creditsUsed, creditsRemaining, error: "response.data is not an array" };
    }

    const holdings: NansenHolding[] = data.map((h) => {
      const o = (h ?? {}) as Record<string, unknown>;
      return {
        chain: asString(o.chain),
        token_address: asString(o.token_address),
        token_symbol: asString(o.token_symbol),
        token_sectors: Array.isArray(o.token_sectors)
          ? o.token_sectors.filter((s): s is string => typeof s === "string")
          : undefined,
        value_usd: asNumber(o.value_usd),
        balance_24h_percent_change: asNumber(o.balance_24h_percent_change),
        holders_count: asNumber(o.holders_count),
        share_of_holdings_percent: asNumber(o.share_of_holdings_percent),
        market_cap_usd: asNumber(o.market_cap_usd),
      };
    });
    console.log(`[NANSEN] ${holdings.length} smart-money holdings received`);
    return { ok: true, status: res.status, holdings, creditsUsed, creditsRemaining };
  } catch (err) {
    return { ok: false, status: 0, holdings: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
