import type { YieldPool, SmartMoneyMatch } from "../inputs/yield";
import type { Allocation } from "../inputs/portfolio";

export type RebalanceAction = "MOVE" | "HOLD" | "EVACUATE" | "STOP";

/** What the engine knows about prior moves (read from the append-only store). */
export interface RebalanceHistory {
  /** Number of MOVE/EVACUATE decisions already recorded for today. */
  movesToday: number;
  /** ISO timestamp of the most recent MOVE decision, if any. */
  lastMoveAt?: string;
  /** Portfolio value at program start, for the drawdown brake (if known). */
  startValueUsd?: number;
}

export interface EstimatedCost {
  gasUsd: number;
  slippageUsd: number;
  totalUsd: number;
}

/** One candidate pool considered by the engine, with why it was kept/rejected. */
export interface CandidateEval {
  protocol?: string;
  symbol?: string;
  apy?: number;
  apyDeltaPct?: number;
  /** Smart-money holding USD of the pool's composition tokens (token granularity). */
  smartMoneyTokenValueUsd?: number;
  smartMoneyAvailable: boolean;
  whitelisted: boolean;
  verdict: "selected" | "rejected";
  note: string;
}

/** Destination pool snapshot recorded with the decision. */
export interface DestinationSnapshot {
  protocol?: string;
  poolId?: string;
  symbol?: string;
  apy?: number;
  tvlUsd?: number;
  smartMoney?: SmartMoneyMatch;
}

export interface RebalanceDecision {
  action: RebalanceAction;
  reason: string;
  /** Which smart-money signal drove the call, or "スマートマネー確認なし". */
  smartMoneySignal: string;
  apyDeltaPct: number | null;
  from?: Pick<Allocation, "protocol" | "pool" | "valueUsd" | "apy">;
  to?: DestinationSnapshot;
  moveUsd: number | null;
  estimatedCost: EstimatedCost | null;
  /** Projected yield gain over the holding horizon, USD (for the cost gate). */
  projectedGainUsd: number | null;
  evaluated: CandidateEval[];
}

// re-export for convenience
export type { YieldPool };
