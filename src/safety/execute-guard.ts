/**
 * Structural safety guards (section 5 of the mandate brief).
 *
 * InvestX is non-custodial: the operator holds the funds, the agent is granted
 * trade/rebalance rights only. Two guards make the unsafe paths structurally
 * impossible rather than merely discouraged:
 *
 *   1. assertWhitelistedDestination — a rebalance may only route into a pool
 *      whose protocol is on the mandate whitelist. Any transfer toward a
 *      non-whitelisted destination throws before a signature is ever requested.
 *
 *   2. assertExecutePathReal — the live execution path must be proven real (not
 *      a mock) exactly once before the first real on-chain move. Until that
 *      check is wired and passes, this throws, so no decision can silently turn
 *      into a fund movement. In the current scope every decision is recorded
 *      with executed:false and this guard is the thing that keeps it that way.
 */
import type { Mandate } from "../mandate";
import { isWhitelisted } from "../mandate";

export class WhitelistViolationError extends Error {}
export class ExecutePathNotVerifiedError extends Error {}

/**
 * Throw unless `protocol` is on the mandate whitelist. Call this immediately
 * before constructing any transfer/rebalance transaction — there is no code
 * path that moves funds toward a destination this function has not approved.
 */
export function assertWhitelistedDestination(mandate: Mandate, protocol: string | undefined): void {
  if (!isWhitelisted(mandate, protocol)) {
    throw new WhitelistViolationError(
      `[SAFETY] destination protocol "${protocol ?? "(none)"}" is not on the mandate whitelist ` +
        `(${mandate.whitelist.join(", ")}) — transfer blocked`
    );
  }
}

/**
 * Gate that must pass before any real (executed:true) move. It is intentionally
 * unsatisfied in this scope: execution is NOT wired, so live execution is
 * structurally blocked. Wiring real execution means (a) confirming the execute
 * endpoint returns a genuine on-chain tx — not a stub — and (b) setting
 * INVESTX_EXECUTE_PATH_VERIFIED=true after that one-time confirmation.
 *
 * The stub-detector (src/stub-detector.ts) is the mechanism for the "is it
 * real, not a mock?" check; this guard is the switch that the check flips.
 */
export function assertExecutePathReal(): void {
  if (process.env.INVESTX_EXECUTE_PATH_VERIFIED !== "true") {
    throw new ExecutePathNotVerifiedError(
      "[SAFETY] execute path not verified as real. Live execution is blocked. " +
        "Confirm the execute endpoint returns a genuine on-chain tx (not a stub) once, " +
        "then set INVESTX_EXECUTE_PATH_VERIFIED=true. Until then decisions stay executed:false."
    );
  }
}

/** True iff the execute path has been confirmed real (does not throw). */
export function isExecutePathVerified(): boolean {
  return process.env.INVESTX_EXECUTE_PATH_VERIFIED === "true";
}
