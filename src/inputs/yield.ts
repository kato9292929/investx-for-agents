/**
 * Yield Intelligence input parser.
 *
 * Pulls candidate pools out of the Yield Intelligence response: APY, TVL (and
 * 24h change for the brake), and the Nansen smart-money inflow per pool.
 *
 * TODO(schema): the live shape of https://x402yi.vercel.app/api/yield/scan is
 * not confirmed from this environment. Parsing is defensive — it scans the
 * object tree for any pool-like node carrying an APY field and reads the other
 * fields by name + obvious variants. Missing fields stay undefined; we never
 * fabricate an APY or a smart-money number.
 *
 * Smart money: if a pool has no inflow field at all, smartMoneyInflowUsd stays
 * undefined and the decision engine records "スマートマネー確認なし" for it —
 * it is never back-filled with a guessed value.
 */
import { walkObjects, firstKey, asNumber, asString } from "./walk";

export interface YieldPool {
  protocol?: string;
  pool?: string;
  apy?: number; // percent, e.g. 7.4 means 7.4%
  tvlUsd?: number;
  tvlChange24hPct?: number;
  smartMoneyInflowUsd?: number; // Nansen smart-money net inflow (undefined = not reported)
  chain?: string;
}

export interface YieldData {
  available: boolean;
  pools: YieldPool[];
  /** true iff at least one pool reports a positive smart-money inflow. */
  smartMoneyConfirmed: boolean;
  peek?: string;
}

const APY_KEYS = ["apy", "apyPct", "apy_pct", "netApy", "supplyApy", "totalApy", "apyBase"];
const PROTOCOL_KEYS = ["protocol", "project", "platform", "protocolName", "provider"];
const POOL_KEYS = ["pool", "poolName", "market", "symbol", "name", "asset", "poolId"];
const TVL_KEYS = ["tvlUsd", "tvl", "tvl_usd", "totalValueLockedUsd", "totalValueLocked"];
const TVL_CHANGE_KEYS = [
  "tvlChange24hPct",
  "tvlChange24h",
  "tvlChangePct24h",
  "tvlChange_24h",
  "tvl24hChangePct",
];
const SMART_MONEY_KEYS = [
  "smartMoneyInflowUsd",
  "smartMoneyInflow",
  "smartMoneyNetFlowUsd",
  "nansenInflowUsd",
  "nansenNetFlowUsd",
  "nansenSmartMoneyInflow",
  "inflowUsd",
];
const CHAIN_KEYS = ["chain", "network", "blockchain"];

function parsePool(obj: Record<string, unknown>): YieldPool | undefined {
  const apyHit = firstKey(obj, APY_KEYS);
  if (!apyHit) return undefined;
  const apy = asNumber(apyHit.value);
  if (apy === undefined) return undefined;

  return {
    protocol: asString(firstKey(obj, PROTOCOL_KEYS)?.value),
    pool: asString(firstKey(obj, POOL_KEYS)?.value),
    apy,
    tvlUsd: asNumber(firstKey(obj, TVL_KEYS)?.value),
    tvlChange24hPct: asNumber(firstKey(obj, TVL_CHANGE_KEYS)?.value),
    smartMoneyInflowUsd: asNumber(firstKey(obj, SMART_MONEY_KEYS)?.value),
    chain: asString(firstKey(obj, CHAIN_KEYS)?.value),
  };
}

export function parseYieldData(
  data: Record<string, unknown> | undefined | null
): YieldData {
  if (!data) return { available: false, pools: [], smartMoneyConfirmed: false };

  const pools: YieldPool[] = [];
  const seen = new Set<string>();
  for (const obj of walkObjects(data)) {
    const pool = parsePool(obj);
    if (!pool) continue;
    // de-dup on protocol+pool+apy so a node walked twice isn't double-counted
    const key = `${pool.protocol ?? "?"}|${pool.pool ?? "?"}|${pool.apy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pools.push(pool);
  }

  const smartMoneyConfirmed = pools.some(
    (p) => p.smartMoneyInflowUsd !== undefined && p.smartMoneyInflowUsd > 0
  );

  return {
    available: pools.length > 0,
    pools,
    smartMoneyConfirmed,
    peek: JSON.stringify(data).slice(0, 200),
  };
}
