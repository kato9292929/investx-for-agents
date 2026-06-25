# InvestX for Agents

Non-custodial R&D agent that follows where smart money parks capital and
rebalances self-funded (~$10k scale) DeFi yield positions accordingly. The goal
is not profit — it is a **verifiable public record**: a tamper-evident,
move-by-move decision log tied to this agent's own ERC-8004 agentId.

スマートマネーが資金を置いている場所を追って、自己資金を DeFi 利回りに自動リバランスする非カストディなエージェントです。狙いは収益ではなく、改竄できない一手ごとの公開記録（このエージェント専用の新規 agentId に紐づくログ）を作ること。記録が成果物です。失っていい額で回します。

Built on the payment/record/cron plumbing of
[x402-Autonomous-Agent](https://github.com/kato9292929/x402-Autonomous-Agent-)
(the AA repo); only the decision logic is new.

> Status: R&D. Execution is **not** wired. Every run records a decision with
> `executed: false` — what the agent decided, never a fill, gas, or P&L. Live
> execution is structurally blocked (see Safety).

---

## What it does each run

1. Pays two x402 endpoints (URLs + 402 costs copied from AA's live config):
   - **Yield Intelligence** (`/api/yield/scan`, $0.20) — candidate-pool APY plus
     Nansen smart-money inflow.
   - **Portfolio Intelligence** (`/api/portfolio/analyze`, $0.50, POST) — a
     self-check of the current allocation.
2. Parses both **defensively** (the live response schemas are not yet confirmed —
   see `src/inputs/*`, marked TODO). If no pool reports a positive smart-money
   inflow, it records **"スマートマネー確認なし"** rather than inventing one.
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

This agent registers its **own** agentId — fully separate from AA's `55560` —
and records to its own store key (`investx_daily`), never AA's
`trade_agent_daily`. Until registration is done, a provisional id
(`investx-provisional-001`) is used and records are stamped
`agentIdProvisional: true`.

```
node dist/scripts/erc8004-register.js   # mints INVESTX_AGENT_ID
# set INVESTX_AGENT_ID, redeploy
node dist/scripts/erc8004-set-uri.js    # links the agent-card URI on-chain
node dist/scripts/erc8004-verify.js     # confirms on-chain state
```

## Reused from AA (unchanged plumbing)

`src/x402.ts`, `src/circle/*` (Base = Circle DCW, Solana = SVM exact),
`src/caller.ts`, `src/store/upstash-rest.ts`, `src/stub-detector.ts`, the
append-only record mechanism, and the Railway/node-cron runtime. Only the
decision logic (`src/inputs/*`, `src/decision/*`, `src/mandate.ts`,
`src/safety/*`) is new.

## Local run

```bash
npm install
cp .env.example .env            # fill in values

# Offline verification — no payment, no network, no execution.
# Exercises the real mandate → parse → decide → record path with fixtures and
# writes to data/decisions/investx-decisions.jsonl under the (provisional) agentId.
npm run dry-run                 # MOVE scenario
npm run dry-run -- nosm         # スマートマネー確認なし → HOLD
npm run dry-run -- brake        # held-pool TVL collapse → EVACUATE

npm run build                   # tsc
npm run run-now                 # one live run (pays the two endpoints)
npm start                       # cron scheduler (daily 06:00 JST / 21:00 UTC)
```

The decision log is the deliverable. `GET /api/decisions/latest` serves the most
recent record read-only; `GET /.well-known/agent-card.json` serves the ERC-8004
agent card.

## Deployment (Railway)

Same shape as AA: `railway.json` handles build/start; node-cron fires at 21:00
UTC daily; the HTTP server listens on `$PORT`.

## License

MIT
