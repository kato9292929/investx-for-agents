/**
 * Portfolio (current allocation) input.
 *
 * The self-hosted Portfolio Intelligence endpoint is no longer used (this task
 * removes that dependency). Until on-chain wallet reading is wired, the current
 * allocation is read from a local holdings file (config/holdings.json or
 * INVESTX_HOLDINGS_PATH). If that file is absent or empty, the portfolio is
 * "unknown" (available:false) — it is never filled with dummy positions.
 *
 * A holdings file lets the engine evaluate the drawdown/TVL brakes and size
 * moves against the real current placement. With no file, the engine records
 * that it could not assess the current allocation and holds.
 *
 * File shape (defensive — keys are matched tolerantly):
 *   { "totalValueUsd": 10000,
 *     "positions": [
 *       { "protocol": "drift", "poolId": "<llama-pool-id>", "symbol": "USDC",
 *         "valueUsd": 3000, "apy": 5.0, "openedAt": "2026-06-01T00:00:00Z" }
 *     ] }
 */
import * as fs from "fs";
import * as path from "path";
import { walkObjects, firstKey, asNumber, asString } from "./walk";

export interface Allocation {
  protocol?: string;
  pool?: string;
  poolId?: string; // DeFiLlama pool id, for TVL-brake chart lookup
  valueUsd?: number;
  apy?: number;
  openedAt?: string;
}

export interface PortfolioData {
  available: boolean;
  source: "local-holdings" | "unavailable";
  totalValueUsd?: number;
  allocations: Allocation[];
  note?: string;
  peek?: string;
}

const VALUE_KEYS = ["valueUsd", "value_usd", "usdValue", "balanceUsd", "amountUsd", "value"];
const PROTOCOL_KEYS = ["protocol", "project", "platform", "protocolName", "provider"];
const POOL_KEYS = ["pool", "poolName", "market", "symbol", "name", "asset"];
const POOLID_KEYS = ["poolId", "pool_id", "llamaPoolId"];
const APY_KEYS = ["apy", "apyPct", "netApy", "supplyApy", "totalApy"];
const OPENED_KEYS = ["openedAt", "opened_at", "since", "enteredAt", "entryTime", "timestamp"];
const TOTAL_KEYS = ["totalValueUsd", "totalUsd", "totalValue", "portfolioValueUsd", "netWorthUsd", "aum"];

function parseAllocation(obj: Record<string, unknown>): Allocation | undefined {
  const valHit = firstKey(obj, VALUE_KEYS);
  if (!valHit) return undefined;
  const valueUsd = asNumber(valHit.value);
  if (valueUsd === undefined) return undefined;
  const protocol = asString(firstKey(obj, PROTOCOL_KEYS)?.value);
  const pool = asString(firstKey(obj, POOL_KEYS)?.value);
  if (!protocol && !pool) return undefined;

  return {
    protocol,
    pool,
    poolId: asString(firstKey(obj, POOLID_KEYS)?.value),
    valueUsd,
    apy: asNumber(firstKey(obj, APY_KEYS)?.value),
    openedAt: asString(firstKey(obj, OPENED_KEYS)?.value),
  };
}

/** Parse a raw holdings object (file contents or a fixture) into PortfolioData. */
export function parseHoldings(data: Record<string, unknown> | undefined | null): PortfolioData {
  if (!data) return { available: false, source: "unavailable", allocations: [], note: "holdings 未指定" };

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

  if (totalValueUsd === undefined && allocations.length > 0) {
    totalValueUsd = allocations.reduce((s, a) => s + (a.valueUsd ?? 0), 0);
  }

  const available = allocations.length > 0 || totalValueUsd !== undefined;
  return {
    available,
    source: available ? "local-holdings" : "unavailable",
    totalValueUsd,
    allocations,
    note: available ? undefined : "holdings ファイルが空",
    peek: JSON.stringify(data).slice(0, 200),
  };
}

function holdingsPath(): string {
  return process.env.INVESTX_HOLDINGS_PATH ?? path.join(process.cwd(), "config", "holdings.json");
}

/** Load the local holdings file. Absent/unreadable → unavailable (not dummy). */
export function loadHoldings(): PortfolioData {
  const file = holdingsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    console.warn(`[PORTFOLIO] holdings file not found at ${file} — current allocation unknown`);
    return { available: false, source: "unavailable", allocations: [], note: `holdings ファイルなし (${file})` };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return {
      available: false,
      source: "unavailable",
      allocations: [],
      note: `holdings ファイルが不正な JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return parseHoldings(parsed);
}
