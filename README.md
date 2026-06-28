# InvestX for Agents

Non-custodial R&D agent that follows where smart money parks capital and
rebalances self-funded (~$10k scale) DeFi yield positions accordingly. The goal
is not profit — it is a **verifiable public record**: a tamper-evident,
move-by-move decision log tied to this agent's own ERC-8004 agentId.

スマートマネーが資金を置いている場所を追って、自己資金を DeFi 利回りに自動リバランスする非カストディなエージェントです。狙いは収益ではなく、改竄できない一手ごとの公開記録（このエージェント専用の新規 agentId に紐づくログ）を作ること。記録が成果物です。失っていい額で回します。

No payment or signing dependencies: inputs are read directly from DeFiLlama
(free) and Nansen (apiKey). The cron/runtime shape follows
[x402-Autonomous-Agent](https://github.com/kato9292929/x402-Autonomous-Agent-)
(the AA repo), but the x402/Circle/wallet payment stack was removed — it is not
needed here and was the cause of past startup crashes.

> Status: R&D. Execution is **not** wired. Every run records a decision with
> `executed: false` — what the agent decided, never a fill, gas, or P&L. Live
> execution is structurally blocked (see Safety).

---

## What it does each run

1. Pulls inputs from primary sources directly — no self-hosted Yield/Portfolio
   middle layer:
   - DeFiLlama `GET https://yields.llama.fi/pools` (free, no key) — candidate-pool
     APY, TVL, and composition tokens. Filtered to `chain === "Solana"` and
     whitelisted protocols. `apy` is a percent.
   - Nansen `POST /smart-money/holdings` (apiKey) — smart-money holdings, which
     are per **token** (not per pool, not per protocol).
2. Maps smart money to pools by the pool's composition tokens (`symbol` /
   `underlyingTokens`): a pool's figure is the sum of its tokens' `value_usd`.
   This is the smart money sitting in the pool's composition tokens — pools
   sharing a token share the figure; pool-level differences are never invented.
   Token-symbol variants are matched only when certain (e.g. WSOL→SOL); anything
   that does not match cleanly is recorded as smart-money unknown. If nothing
   matches, the run records **"スマートマネー確認なし"** rather than inventing one.
   - Current allocation comes from a local holdings file
     (`config/holdings.json`); if absent it is recorded as unknown, never dummy.
   - On any source failure (401/402/403/429/non-200/empty) the affected input is
     recorded as unknown with its status — never filled with a placeholder.
3. Runs the decision engine (`src/decision/rebalance.ts`) against the rules in
   `mandate.yaml` and emits exactly one decision: `STOP`, `EVACUATE`, `MOVE`, or
   `HOLD`.
4. Appends an immutable record (time, input snapshot, decision + reason +
   which smart-money signal mattered, APY delta, estimated cost, before/after
   allocation, tx hash) to the append-only store under this agent's agentId.

## Decision rules — `mandate.yaml`

Every threshold lives in `mandate.yaml`, loaded by `src/mandate.ts`; the code
hard-codes nothing. Starting values:

- Whitelist protocols only: Kamino / Drift / Jupiter Lend / Morpho.
- Move when smart money is present **and** APY is ≥ +2% above the current
  placement.
- Move ≥ $500, ≤ 1 move/day, ≥ 72h min hold; skip if gas + slippage exceed the
  projected gain over the holding horizon.
- Caps: ≤ 30% per pool, ≤ 50% per protocol, ≥ 10% idle in USDC.
- Brakes: a held pool's TVL down 30% in 24h → EVACUATE; whole account down 10%
  from start → STOP + notify.

## Safety (structural)

- Funds stay in the operator's wallet. The agent is granted trade/rebalance
  rights only — non-custodial.
- `assertWhitelistedDestination` (`src/safety/execute-guard.ts`) makes a transfer
  to any non-whitelisted protocol throw before a signature is requested.
- `assertExecutePathReal` blocks live execution until the execute endpoint is
  confirmed to return a genuine on-chain tx (not a stub) and
  `INVESTX_EXECUTE_PATH_VERIFIED=true` is set. Until then, `executed: false`.

## Identity (ERC-8004)

Records are tied to this agent's **own** agentId — fully separate from AA's
`55560` — under its own store key (`investx_daily`), never AA's
`trade_agent_daily`. Set `INVESTX_AGENT_ID` to the agent's id; until then a
provisional id (`investx-provisional-001`) is used and records are stamped
`agentIdProvisional: true`. The registry constant lives in
`src/erc8004/contract.ts` and is recorded as `agentRegistry` on every decision.

On-chain ERC-8004 registration is not included here: the previous register
scripts required Circle signing, which was removed with the payment stack.
When a real execute/signing path is added, registration will be done there and
`INVESTX_AGENT_ID` set to the minted id. (TODO)

## Inputs: primary sources

| Source | Call | Auth | Provides |
|---|---|---|---|
| DeFiLlama | `GET https://yields.llama.fi/pools` (+ `/chart/{pool}` for the 24h TVL brake) | none | apy, tvlUsd, composition tokens |
| Nansen | `POST https://api.nansen.ai/api/v1/smart-money/holdings` | `apiKey` | smart-money `value_usd` per token |

Sandbox note: in the Claude Code environment both hosts are egress-blocked, so
real-data observation is deferred to a Railway deploy (where egress is open).
The `dry-run` exercises the full mapping/decision/record path with fixtures
shaped exactly like the confirmed specs.

## Payment stack: removed

InvestX has no x402 / Circle / wallet-signing code. The earlier build copied
that payment plumbing from AA on the input path; it was unused (DeFiLlama is
free, Nansen uses an apiKey) and its startup initialisation repeatedly crashed
Railway, so it was deleted entirely. Runtime dependencies are just `node-cron`,
`dotenv`, and `yaml`. From AA only the ERC-8004 registry constants
(`src/erc8004/contract.ts`, for the agentId record field) and the cron/Railway
runtime shape remain. All other code is new: `src/sources/*` (DeFiLlama +
Nansen), `src/inputs/*`, `src/decision/*`, `src/mandate.ts`, `src/safety/*`,
`src/store/decision-store.ts`.

If a real execute path is added later, payment/signing will be built then —
isolated, and never initialised at startup.

## Local run

```bash
npm install
cp .env.example .env            # fill in values

# Offline verification — no payment, no network, no execution.
# Exercises the real mandate → parse → decide → record path with fixtures and
# writes to data/decisions/investx-decisions.jsonl under the (provisional) agentId.
npm run dry-run                 # MOVE (smart money matched)
npm run dry-run -- nosm         # Nansen unavailable → スマートマネー確認なし → HOLD
npm run dry-run -- nomatch      # tokens don't match a holding → unknown → HOLD
npm run dry-run -- brake        # held-pool TVL collapse → EVACUATE

npm run build                   # tsc
npm run run-now                 # one live run (DeFiLlama free + Nansen apiKey)
npm start                       # cron scheduler (daily 06:00 JST / 21:00 UTC)
```

The decision log is the deliverable. `GET /api/decisions/latest` serves the most
recent record read-only; `GET /.well-known/agent-card.json` serves the ERC-8004
agent card.

## Deployment (Railway)

Same shape as AA: `railway.json` handles build/start; node-cron fires at 21:00
UTC daily; the HTTP server listens on `$PORT`.

## Kamino execution (v1) — Railway で回す手順

実行は既定オフ。`KAMINO_FROM_VAULT`/`KAMINO_TO_VAULT`/`SOLANA_RPC_URL` が無ければ
判断＋記録のみで、現行の日次ループ（DeFiLlama/Nansen→判断→記録）は不変です。
klend-sdk と @solana/kit は実行時のみ動的 import され、起動パスには載りません。

対象は Kamino の Earn vault 間で、自分のウォレット（6JKV…）が保有する USDC を移動
するだけ（外部送金なし・非カストディ）。Drift / Jupiter Lend は v1 では実行しません。

### env（Railway Variables）

| 変数 | 説明 |
|---|---|
| `SOLANA_KEYPAIR` | 6JKV… の id.json バイト（64要素の JSON 配列）。新規生成不可。起動時に address を assert |
| `SOLANA_RPC_URL` | Solana mainnet RPC |
| `KAMINO_FROM_VAULT` / `KAMINO_TO_VAULT` | 自分が保有する Kamino Earn vault のアドレス（移動元 / 先） |
| `KAMINO_MOVE_USD` | 移動額 USDC（既定 1） |
| `EXECUTE_ENABLED` | 既定 `false`。simulate が通るまで `false` のまま |

### 回し方（Railway → Console）

1. まず `EXECUTE_ENABLED=false` のまま実行：`node dist/index.js --run-now`
2. ログで simulate 結果を確認：
   - `[RUN] Kamino exec — attempted=… rpc=… simulated=ok|failed executed=false`
   - `[RUN] Kamino note: …`
   - `simulated=failed` → note のエラーで修正（送信されません）。`rpc=false` → RPC を確認（捏造せず「不明」記録）
3. `simulated=ok` を確認できたら `EXECUTE_ENABLED=true` にして、もう一度 `node dist/index.js --run-now` を1回
4. ログ `[RUN] Kamino note: mainnet 送信成立: <signature>` の `<signature>` を Solana エクスプローラ（solscan / explorer.solana.com）で確認
5. 記録は `GET /api/decisions/latest`（または `data/decisions/investx-decisions.jsonl`）に
   `executed:true` / `tx_hash` / `chain:"solana"` / `protocol:"kamino"` 付きで残ります

鉄則: simulate が通るまで $1 送信しない（`EXECUTE_ENABLED` と simulate 必須ゲートで
構造担保）。txHash がエクスプローラで確認できるまで「結線できた」とは言いません。

## License

MIT
