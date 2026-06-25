/**
 * mandate.yaml loader.
 *
 * Reads the rebalance rules from mandate.yaml at the repo root (or MANDATE_PATH)
 * and validates the shape. The decision engine receives a typed Mandate and
 * never hard-codes a threshold — every number lives in the YAML so a reviewer
 * can audit the rules separately from the code.
 */
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

export interface Mandate {
  whitelist: string[];
  move: {
    apyImprovementMinPct: number;
    requireSmartMoney: boolean;
    minMoveUsd: number;
    maxMovesPerDay: number;
    minHoldHours: number;
    gainHorizonHours: number;
    costMustBeBelowGain: boolean;
  };
  allocationCaps: {
    maxPoolPct: number;
    maxProtocolPct: number;
    minUsdcIdlePct: number;
  };
  brakes: {
    poolTvlDrop24hPct: number;
    portfolioDrawdownPct: number;
  };
  costEstimate: {
    gasUsd: number;
    slippagePct: number;
  };
}

function num(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

function mandatePath(): string {
  return process.env.MANDATE_PATH ?? path.join(process.cwd(), "mandate.yaml");
}

export function loadMandate(): Mandate {
  const file = mandatePath();
  const raw = fs.readFileSync(file, "utf-8");
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const whitelist = Array.isArray(doc.whitelist)
    ? doc.whitelist.filter((x): x is string => typeof x === "string")
    : [];
  if (whitelist.length === 0) {
    throw new Error(`[MANDATE] whitelist is empty in ${file} — refusing to run with no allowed protocols`);
  }

  const move = (doc.move ?? {}) as Record<string, unknown>;
  const caps = (doc.allocation_caps ?? {}) as Record<string, unknown>;
  const brakes = (doc.brakes ?? {}) as Record<string, unknown>;
  const cost = (doc.cost_estimate ?? {}) as Record<string, unknown>;

  return {
    whitelist,
    move: {
      apyImprovementMinPct: num(move, "apy_improvement_min_pct", 2.0),
      requireSmartMoney: bool(move, "require_smart_money", true),
      minMoveUsd: num(move, "min_move_usd", 500),
      maxMovesPerDay: num(move, "max_moves_per_day", 1),
      minHoldHours: num(move, "min_hold_hours", 72),
      gainHorizonHours: num(move, "gain_horizon_hours", 720),
      costMustBeBelowGain: bool(move, "cost_must_be_below_gain", true),
    },
    allocationCaps: {
      maxPoolPct: num(caps, "max_pool_pct", 30),
      maxProtocolPct: num(caps, "max_protocol_pct", 50),
      minUsdcIdlePct: num(caps, "min_usdc_idle_pct", 10),
    },
    brakes: {
      poolTvlDrop24hPct: num(brakes, "pool_tvl_drop_24h_pct", 30),
      portfolioDrawdownPct: num(brakes, "portfolio_drawdown_pct", 10),
    },
    costEstimate: {
      gasUsd: num(cost, "gas_usd", 0.5),
      slippagePct: num(cost, "slippage_pct", 0.1),
    },
  };
}

/** Case/space-insensitive whitelist membership check. */
export function isWhitelisted(mandate: Mandate, protocol: string | undefined): boolean {
  if (!protocol) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const target = norm(protocol);
  return mandate.whitelist.some((p) => norm(p) === target);
}
