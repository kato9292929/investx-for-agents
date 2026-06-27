/**
 * Yield input — built from DeFiLlama pools + Nansen smart-money holdings.
 *
 * Replaces the old self-hosted Yield Intelligence endpoint. Pools come from
 * DeFiLlama (apy/tvl/composition), smart money from Nansen.
 *
 * Smart-money mapping (granularity is honest, not inflated):
 *   - Nansen holdings are per TOKEN. A pool's smart-money figure is the sum of
 *     its composition tokens' value_usd. This is "how much smart money sits in
 *     the pool's composition tokens", NOT a pool-specific inflow. Pools sharing
 *     a token therefore share the same figure — we do not invent pool-level
 *     differences.
 *   - token_symbol spelling variants are matched only when certain (e.g.
 *     WSOL→SOL). Anything that does not match cleanly is left as "smart money
 *     unknown" — never fabricated, never force-matched (e.g. USDC vs USDbC are
 *     NOT treated as the same token).
 *
 * apy is kept in percent (DeFiLlama convention; mandate thresholds are percent).
 */
import type { LlamaPool } from "../sources/defillama";
import type { NansenResult, NansenHolding } from "../sources/nansen";

export interface SmartMoneyMatch {
  available: boolean; // a composition token matched a Nansen holding
  tokenValueUsd?: number; // sum of matched tokens' value_usd (token granularity)
  matchedTokens: { symbol: string; valueUsd?: number; sharePct?: number }[];
  note: string; // honest description of what this figure is / why unknown
}

export interface YieldPool {
  protocol?: string; // DeFiLlama project slug
  poolId?: string; // DeFiLlama pool id
  symbol?: string; // composition tokens, e.g. "USDC-SOL"
  apy?: number; // percent
  apyBase?: number;
  apyReward?: number;
  tvlUsd?: number;
  tvlChange24hPct?: number; // from /chart enrichment; undefined = not known
  chain?: string;
  underlyingTokens?: string[];
  symbolTokens?: string[]; // parsed from `symbol`, normalized
  smartMoney: SmartMoneyMatch;
}

export interface YieldData {
  available: boolean;
  source: "defillama+nansen";
  pools: YieldPool[];
  smartMoneyConfirmed: boolean; // some pool has a matched token with value > 0
  llama: { ok: boolean; status: number; poolCount: number };
  nansen: { ok: boolean; status: number; note: string };
  peek?: string;
}

// Only certain spelling variants are unified. Uncertain ones are left to miss.
const SYMBOL_ALIASES: Record<string, string> = {
  WSOL: "SOL",
  WETH: "ETH",
  WBTC: "BTC",
};

export function normalizeSymbol(sym: string): string {
  const up = sym.trim().toUpperCase();
  return SYMBOL_ALIASES[up] ?? up;
}

/** Split a DeFiLlama composition symbol ("USDC-SOL", "USDC/SOL") into tokens. */
export function splitSymbol(symbol: string | undefined): string[] {
  if (!symbol) return [];
  return symbol
    .split(/[-/\s+]/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(normalizeSymbol);
}

/** Index Nansen holdings by normalized token_symbol (keep the largest value). */
function indexHoldings(holdings: NansenHolding[]): Map<string, NansenHolding> {
  const map = new Map<string, NansenHolding>();
  for (const h of holdings) {
    if (!h.token_symbol) continue;
    const key = normalizeSymbol(h.token_symbol);
    const existing = map.get(key);
    if (!existing || (h.value_usd ?? 0) > (existing.value_usd ?? 0)) map.set(key, h);
  }
  return map;
}

function matchSmartMoney(
  symbolTokens: string[],
  nansen: NansenResult,
  index: Map<string, NansenHolding>
): SmartMoneyMatch {
  if (!nansen.ok) {
    return {
      available: false,
      matchedTokens: [],
      note: `スマートマネー不明（Nansen 取得失敗: status=${nansen.status}${nansen.error ? ` ${nansen.error}` : ""}）`,
    };
  }
  const matched: SmartMoneyMatch["matchedTokens"] = [];
  for (const t of symbolTokens) {
    const h = index.get(t);
    if (h) matched.push({ symbol: t, valueUsd: h.value_usd, sharePct: h.share_of_holdings_percent });
  }
  if (matched.length === 0) {
    return {
      available: false,
      matchedTokens: [],
      note: "スマートマネー不明（構成トークンが Nansen holdings に一致せず）",
    };
  }
  const tokenValueUsd = matched.reduce((s, m) => s + (m.valueUsd ?? 0), 0);
  return {
    available: true,
    tokenValueUsd,
    matchedTokens: matched,
    note: "token 粒度: 構成トークンのスマートマネー保有額（プール固有の流入ではない）",
  };
}

/** Is this DeFiLlama project on the whitelist? (normalized, tolerant of slug vs name) */
function projectWhitelisted(project: string | undefined, whitelist: string[]): boolean {
  if (!project) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const p = norm(project);
  return whitelist.some((w) => {
    const wl = norm(w);
    return p === wl || wl.startsWith(p) || p.startsWith(wl);
  });
}

/**
 * Build YieldData from raw DeFiLlama pools + Nansen holdings, filtered to the
 * target chain and whitelisted protocols. The decision engine consumes this.
 */
export function buildYieldData(
  llama: { ok: boolean; status: number; pools: LlamaPool[] },
  nansen: NansenResult,
  opts: { whitelist: string[]; chain: string }
): YieldData {
  const index = indexHoldings(nansen.holdings);
  const chainNorm = opts.chain.toLowerCase();

  const filtered = llama.pools.filter(
    (p) => (p.chain ?? "").toLowerCase() === chainNorm && projectWhitelisted(p.project, opts.whitelist)
  );

  const pools: YieldPool[] = filtered.map((p) => {
    const symbolTokens = splitSymbol(p.symbol);
    return {
      protocol: p.project,
      poolId: p.pool,
      symbol: p.symbol,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward,
      tvlUsd: p.tvlUsd,
      chain: p.chain,
      underlyingTokens: p.underlyingTokens,
      symbolTokens,
      smartMoney: matchSmartMoney(symbolTokens, nansen, index),
    };
  });

  const smartMoneyConfirmed = pools.some(
    (p) => p.smartMoney.available && (p.smartMoney.tokenValueUsd ?? 0) > 0
  );

  const nansenNote = nansen.ok
    ? `ok (${nansen.holdings.length} holdings)`
    : `unavailable (status=${nansen.status}${nansen.error ? ` ${nansen.error}` : ""})`;

  return {
    available: pools.length > 0,
    source: "defillama+nansen",
    pools,
    smartMoneyConfirmed,
    llama: { ok: llama.ok, status: llama.status, poolCount: llama.pools.length },
    nansen: { ok: nansen.ok, status: nansen.status, note: nansenNote },
    peek: JSON.stringify(pools.slice(0, 3)).slice(0, 300),
  };
}
