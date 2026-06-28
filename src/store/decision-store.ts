/**
 * Append-only store for InvestX rebalance decisions — the project's deliverable.
 *
 * Every run records one immutable decision (MOVE / HOLD / EVACUATE / STOP) tied
 * to this agent's own ERC-8004 agentId. Records are never edited or deleted:
 * hits, misses, and HOLDs all stay, so the public log is a tamper-evident,
 * move-by-move history.
 *
 * This is deliberately a SEPARATE store from the upstream AA repo's
 * `trade_agent_daily:55560`. InvestX uses its own key prefix (`investx_daily`)
 * and its own local file, fully decoupled from AA's identity and data.
 *
 * Backends (a record is written to every configured backend):
 *   1. Upstash Redis REST — RPUSH onto `investx_daily:<agentId>` when
 *      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 *   2. Local JSONL — data/decisions/investx-decisions.jsonl — always.
 *
 * Nothing here executes a trade. Records carry executed:false.
 */
import * as fs from "fs";
import * as path from "path";
import type { RebalanceDecision } from "../decision/types";
import type { YieldData } from "../inputs/yield";
import type { PortfolioData, Allocation } from "../inputs/portfolio";
import type { KaminoExecResult } from "../execute/kamino";

export const STORE_KEY_PREFIX = "investx_daily";

export interface RebalanceRecord {
  date: string; // YYYY-MM-DD
  timestamp: string; // ISO 8601
  agentId: string; // this agent's ERC-8004 agentId (NOT AA's 55560)
  agentIdProvisional: boolean; // true while using a placeholder id pre-registration
  agentRegistry?: string; // ERC-8004 registry CAIP-10, for traceability
  // input snapshot (primary sources: DeFiLlama + Nansen, and local holdings)
  inputSnapshot: {
    yield: {
      available: boolean;
      source: string; // "defillama+nansen"
      poolCount: number; // whitelisted+chain-filtered pools considered
      smartMoneyConfirmed: boolean;
      llama: { ok: boolean; status: number; totalPoolCount: number };
      nansen: { ok: boolean; status: number; note: string };
      peek?: string;
    };
    portfolio: {
      available: boolean;
      source: string; // "local-holdings" | "unavailable"
      totalValueUsd?: number;
      allocationCount: number;
      note?: string;
      peek?: string;
    };
  };
  // the decision
  action: RebalanceDecision["action"];
  reason: string;
  smartMoneySignal: string; // which smart-money signal mattered, or "スマートマネー確認なし"
  apyDeltaPct: number | null;
  from?: RebalanceDecision["from"];
  to?: RebalanceDecision["to"];
  moveUsd: number | null;
  // before/after allocation (after is null while executed:false)
  allocationBefore: Allocation[];
  allocationAfter: Allocation[] | null;
  // costs
  estimatedCostUsd: RebalanceDecision["estimatedCost"]; // gas+slippage estimate
  actualGasUsd: number | null; // real gas — only set on a real execution
  projectedGainUsd: number | null;
  txHash: string | null; // Solana signature, only on a real send
  chain?: string; // "solana" when execution was attempted
  protocol?: string; // "kamino" when execution was attempted
  execution?: KaminoExecResult; // full Kamino execution trace (read/simulate/send)
  inputCostUsdc: number; // input fetches make no payment (DeFiLlama free, Nansen apiKey)
  evaluated: RebalanceDecision["evaluated"];
  executed: boolean; // true ONLY when a real mainnet send succeeded
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildRecord(args: {
  agentId: string;
  agentIdProvisional: boolean;
  agentRegistry?: string;
  decision: RebalanceDecision;
  yield: YieldData;
  portfolio: PortfolioData;
  inputCostUsdc: number;
  execution?: KaminoExecResult;
}): RebalanceRecord {
  const { decision, yield: yieldData, portfolio } = args;
  return {
    date: todayDate(),
    timestamp: new Date().toISOString(),
    agentId: args.agentId,
    agentIdProvisional: args.agentIdProvisional,
    agentRegistry: args.agentRegistry,
    inputSnapshot: {
      yield: {
        available: yieldData.available,
        source: yieldData.source,
        poolCount: yieldData.pools.length,
        smartMoneyConfirmed: yieldData.smartMoneyConfirmed,
        llama: {
          ok: yieldData.llama.ok,
          status: yieldData.llama.status,
          totalPoolCount: yieldData.llama.poolCount,
        },
        nansen: {
          ok: yieldData.nansen.ok,
          status: yieldData.nansen.status,
          note: yieldData.nansen.note,
        },
        peek: yieldData.peek,
      },
      portfolio: {
        available: portfolio.available,
        source: portfolio.source,
        totalValueUsd: portfolio.totalValueUsd,
        allocationCount: portfolio.allocations.length,
        note: portfolio.note,
        peek: portfolio.peek,
      },
    },
    action: decision.action,
    reason: decision.reason,
    smartMoneySignal: decision.smartMoneySignal,
    apyDeltaPct: decision.apyDeltaPct,
    from: decision.from,
    to: decision.to,
    moveUsd: decision.moveUsd,
    allocationBefore: portfolio.allocations,
    allocationAfter: null, // executed:false — no post-move allocation yet
    estimatedCostUsd: decision.estimatedCost,
    actualGasUsd: null,
    projectedGainUsd: decision.projectedGainUsd,
    txHash: args.execution?.txHash ?? null,
    chain: args.execution?.attempted ? "solana" : undefined,
    protocol: args.execution?.attempted ? "kamino" : undefined,
    execution: args.execution,
    inputCostUsdc: args.inputCostUsdc,
    evaluated: decision.evaluated,
    executed: args.execution?.executed ?? false,
  };
}

function localFilePath(): string {
  return path.join(process.cwd(), "data", "decisions", "investx-decisions.jsonl");
}

function appendLocal(record: RebalanceRecord): void {
  const file = localFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf-8");
  console.log(`[STORE] Decision appended → ${file}`);
}

async function appendUpstash(record: RebalanceRecord): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return; // backend not configured — silently skip

  const key = `${STORE_KEY_PREFIX}:${record.agentId}`;
  const endpoint = `${url.replace(/\/$/, "")}/rpush/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.warn(`[STORE] Upstash RPUSH failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    console.log(`[STORE] Decision appended → Upstash (${key})`);
  } catch (err) {
    console.warn(`[STORE] Upstash RPUSH error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Append one decision to every configured backend. Local write is fatal-safe. */
export async function appendDecision(record: RebalanceRecord): Promise<void> {
  appendLocal(record);
  await appendUpstash(record);
}

/** Read locally-recorded decisions (newest backend of truth for history). */
export function readLocalDecisions(): RebalanceRecord[] {
  const file = localFilePath();
  try {
    return fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as RebalanceRecord);
  } catch {
    return [];
  }
}

/**
 * Derive the history the engine needs from the local log: moves recorded today
 * and the timestamp of the most recent MOVE. startValueUsd comes from env
 * (INVESTX_START_VALUE_USD) if set, else the earliest recorded portfolio total.
 */
export function readHistory(): { movesToday: number; lastMoveAt?: string; startValueUsd?: number } {
  const records = readLocalDecisions();
  const today = todayDate();
  const moveActions = records.filter((r) => r.action === "MOVE" || r.action === "EVACUATE");

  const movesToday = moveActions.filter((r) => r.date === today).length;
  const lastMoveAt = moveActions.length > 0 ? moveActions[moveActions.length - 1].timestamp : undefined;

  let startValueUsd: number | undefined;
  const envStart = process.env.INVESTX_START_VALUE_USD;
  if (envStart && Number.isFinite(Number(envStart))) {
    startValueUsd = Number(envStart);
  } else {
    const firstWithTotal = records.find((r) => r.inputSnapshot.portfolio.totalValueUsd !== undefined);
    startValueUsd = firstWithTotal?.inputSnapshot.portfolio.totalValueUsd;
  }

  return { movesToday, lastMoveAt, startValueUsd };
}
