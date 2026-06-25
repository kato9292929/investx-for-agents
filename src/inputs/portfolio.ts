/**
 * Portfolio Intelligence input parser.
 *
 * Reads the current allocation self-check: total portfolio value and the list
 * of held positions (protocol, pool, USD value, APY, and — if present — when
 * the position was opened, for the 72h min-hold rule).
 *
 * TODO(schema): the live shape of https://x402pi.vercel.app/api/portfolio/analyze
 * is not confirmed. Parsing is defensive — it scans for position-like nodes
 * carrying a USD value and reads the rest by name + variants. Missing fields stay
 * undefined; nothing is fabricated.
 */
import { walkObjects, firstKey, asNumber, asString } from "./walk";

export interface Allocation {
  protocol?: string;
  pool?: string;
  valueUsd?: number;
  apy?: number;
  openedAt?: string; // ISO timestamp if the endpoint reports it; else undefined
}

export interface PortfolioData {
  available: boolean;
  totalValueUsd?: number;
  allocations: Allocation[];
  peek?: string;
}

const VALUE_KEYS = ["valueUsd", "value_usd", "usdValue", "balanceUsd", "amountUsd", "value"];
const PROTOCOL_KEYS = ["protocol", "project", "platform", "protocolName", "provider"];
const POOL_KEYS = ["pool", "poolName", "market", "symbol", "name", "asset", "poolId"];
const APY_KEYS = ["apy", "apyPct", "netApy", "supplyApy", "totalApy"];
const OPENED_KEYS = ["openedAt", "opened_at", "since", "enteredAt", "entryTime", "timestamp"];
const TOTAL_KEYS = [
  "totalValueUsd",
  "totalUsd",
  "totalValue",
  "portfolioValueUsd",
  "netWorthUsd",
  "aum",
];

function parseAllocation(obj: Record<string, unknown>): Allocation | undefined {
  const valHit = firstKey(obj, VALUE_KEYS);
  if (!valHit) return undefined;
  const valueUsd = asNumber(valHit.value);
  if (valueUsd === undefined) return undefined;
  // a position node should also carry a protocol or pool identifier
  const protocol = asString(firstKey(obj, PROTOCOL_KEYS)?.value);
  const pool = asString(firstKey(obj, POOL_KEYS)?.value);
  if (!protocol && !pool) return undefined;

  return {
    protocol,
    pool,
    valueUsd,
    apy: asNumber(firstKey(obj, APY_KEYS)?.value),
    openedAt: asString(firstKey(obj, OPENED_KEYS)?.value),
  };
}

export function parsePortfolioData(
  data: Record<string, unknown> | undefined | null
): PortfolioData {
  if (!data) return { available: false, allocations: [] };

  // total value: first top-level-ish match anywhere in the tree
  let totalValueUsd: number | undefined;
  for (const obj of walkObjects(data)) {
    const hit = firstKey(obj, TOTAL_KEYS);
    if (hit) {
      const n = asNumber(hit.value);
      if (n !== undefined) {
        totalValueUsd = n;
        break;
      }
    }
  }

  const allocations: Allocation[] = [];
  const seen = new Set<string>();
  for (const obj of walkObjects(data)) {
    const a = parseAllocation(obj);
    if (!a) continue;
    const key = `${a.protocol ?? "?"}|${a.pool ?? "?"}|${a.valueUsd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allocations.push(a);
  }

  // fall back to sum of positions if no explicit total was reported
  if (totalValueUsd === undefined && allocations.length > 0) {
    totalValueUsd = allocations.reduce((s, a) => s + (a.valueUsd ?? 0), 0);
  }

  return {
    available: allocations.length > 0 || totalValueUsd !== undefined,
    totalValueUsd,
    allocations,
    peek: JSON.stringify(data).slice(0, 200),
  };
}
