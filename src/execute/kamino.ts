/**
 * Kamino in-wallet rebalance executor (v1).
 *
 * Moves USDC from one Kamino Earn vault to another, both owned by the wallet
 * (6WyH...). Non-custodial: there is no external-transfer path — funds only
 * move between the wallet's own Kamino positions.
 *
 * Flow: read vault state → build withdraw+deposit ixs → SIMULATE → (only if
 * simulate passes AND EXECUTE_ENABLED=true) send one mainnet tx → return txHash.
 *
 * Hard rules:
 *   - EXECUTE_ENABLED=false (default) stops after simulate; never sends.
 *   - If simulate fails, we never send (and record the failure).
 *   - RPC unreachable / read failure is reported as unknown, never fabricated.
 *   - The signer must be 6WyH... (loadInvestxSigner asserts this).
 *
 * NOTE (verification): this environment cannot reach Solana mainnet RPC, so the
 * read/simulate/send paths below are type-checked but NOT runtime-verified here.
 * They must be exercised on Railway (or a host with RPC + key). The first
 * simulate may need adjustment (e.g. LUTs / farm states); that is expected and
 * is why EXECUTE_ENABLED + the simulate gate exist.
 */
import {
  createSolanaRpc,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  type Base64EncodedWireTransaction,
} from "@solana/kit";
import { KaminoVault, KaminoVaultClient } from "@kamino-finance/klend-sdk";
import Decimal from "decimal.js";
import { loadInvestxSigner } from "../solana/signer";
import * as cfg from "./config";

export interface KaminoExecResult {
  attempted: boolean;
  rpcReachable: boolean;
  simulated: "ok" | "failed" | "skipped";
  simulateError?: string;
  executed: boolean;
  txHash?: string;
  sendError?: string;
  fromVault?: string;
  toVault?: string;
  moveUsd?: number;
  preState?: Record<string, unknown>;
  postState?: Record<string, unknown> | null;
  note: string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Attempt a Kamino vault→vault rebalance. Returns a structured result; it never
 * throws so the daily loop is never broken by an execution failure.
 */
export async function executeKaminoRebalance(): Promise<KaminoExecResult> {
  const base: KaminoExecResult = {
    attempted: false,
    rpcReachable: false,
    simulated: "skipped",
    executed: false,
    postState: null,
    note: "",
  };

  if (!cfg.SOLANA_RPC_URL) return { ...base, note: "SOLANA_RPC_URL 未設定 — Kamino 実行スキップ" };
  if (!cfg.KAMINO_FROM_VAULT || !cfg.KAMINO_TO_VAULT) {
    return { ...base, note: "KAMINO_FROM_VAULT/KAMINO_TO_VAULT 未設定 — 実行スキップ" };
  }

  base.attempted = true;
  base.fromVault = cfg.KAMINO_FROM_VAULT;
  base.toVault = cfg.KAMINO_TO_VAULT;
  base.moveUsd = cfg.KAMINO_MOVE_USD;

  // Signer (asserts 6WyH...). Missing/invalid key → skip, recorded as unknown.
  let signer;
  try {
    signer = await loadInvestxSigner();
  } catch (e) {
    return { ...base, note: `signer ロード失敗（実行不可）: ${msg(e)}` };
  }

  const rpc = createSolanaRpc(cfg.SOLANA_RPC_URL);
  const client = new KaminoVaultClient(rpc, cfg.SLOT_DURATION_MS);
  const fromVault = new KaminoVault(rpc, address(cfg.KAMINO_FROM_VAULT));
  const toVault = new KaminoVault(rpc, address(cfg.KAMINO_TO_VAULT));

  // ── Read (RPC). Failure → unknown, never fabricated. ─────────────────────
  let reservesMap;
  let slot: bigint;
  try {
    const fromState = await fromVault.getState();
    const toState = await toVault.getState();
    reservesMap = await client.loadVaultsReserves([fromState, toState]);
    slot = await rpc.getSlot().send();
    base.rpcReachable = true;
    base.preState = {
      fromVault: cfg.KAMINO_FROM_VAULT,
      toVault: cfg.KAMINO_TO_VAULT,
      slot: slot.toString(),
      fromTokenMint: String(fromState.tokenMint),
      toTokenMint: String(toState.tokenMint),
    };
  } catch (e) {
    return { ...base, rpcReachable: false, note: `RPC 到達/読み取り失敗（現ポジション不明）: ${msg(e)}` };
  }

  // ── Build withdraw + deposit ixs ─────────────────────────────────────────
  let ixs;
  try {
    const tokens = new Decimal(cfg.KAMINO_MOVE_USD);
    const tps = await client.getTokensPerShareSingleVault(fromVault, slot, reservesMap, slot);
    const shares = tps.gt(0) ? tokens.div(tps) : tokens;
    // farm states null = no farm; if a vault has a farm, simulate will reveal it.
    const w = await fromVault.withdrawIxs(signer, shares, slot, reservesMap, null, null);
    const d = await toVault.depositIxs(signer, tokens, reservesMap, null, null);
    ixs = [
      ...w.unstakeFromFarmIfNeededIxs,
      ...w.withdrawIxs,
      ...w.postWithdrawIxs,
      ...d.depositIxs,
      ...d.stakeInFarmIfNeededIxs,
      ...d.stakeInFlcFarmIfNeededIxs,
    ];
  } catch (e) {
    return { ...base, note: `ix 構築失敗: ${msg(e)}` };
  }

  // ── Build + sign transaction message ─────────────────────────────────────
  let wire: Base64EncodedWireTransaction;
  try {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m)
    );
    const signed = await signTransactionMessageWithSigners(message);
    wire = getBase64EncodedWireTransaction(signed);
  } catch (e) {
    return { ...base, note: `tx 構築/署名失敗: ${msg(e)}` };
  }

  // ── SIMULATE (mandatory gate) ────────────────────────────────────────────
  try {
    const sim = await rpc
      .simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true })
      .send();
    if (sim.value.err) {
      return {
        ...base,
        simulated: "failed",
        simulateError: JSON.stringify(sim.value.err),
        note: `simulate 失敗（送信しない）: ${JSON.stringify(sim.value.err)}`,
      };
    }
  } catch (e) {
    return { ...base, simulated: "failed", simulateError: msg(e), note: `simulate RPC 失敗: ${msg(e)}` };
  }
  base.simulated = "ok";

  // ── Gate: only send when explicitly enabled ──────────────────────────────
  if (!cfg.EXECUTE_ENABLED) {
    return { ...base, executed: false, note: "simulate 成立。EXECUTE_ENABLED=false のため送信しない" };
  }

  // ── Send ONE mainnet transaction (minimal amount) ────────────────────────
  try {
    const sig = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
    return {
      ...base,
      executed: true,
      txHash: String(sig),
      note: `mainnet 送信成立: ${String(sig)}（Solana エクスプローラで確認のこと）`,
    };
  } catch (e) {
    return { ...base, executed: false, sendError: msg(e), note: `送信失敗: ${msg(e)}` };
  }
}
