# L3 Deploy Runbook

Operator-driven end-to-end L3 deploy. Run each step in order. Stop and
report if any step fails — do not skip forward.

All commands assume you start in the repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

## Pre-conditions

- [ ] Commits 1–5 are landed on `main`; working tree is clean
      (only committed code — no stray untracked state).
- [ ] L0 probes green (`funded.sh`, `d1.sh`, `rpc.sh`, `cf.sh`).
- [ ] Foundry + vitest suites both green (`cd contracts && forge test`
      and `pnpm -r test`).
- [ ] Infisical hydrates these secrets in the `reckon402/dev` env:
      `DEPLOYER_AWS_ACCESS_KEY_ID`, `DEPLOYER_AWS_SECRET_ACCESS_KEY`,
      `BASE_SEPOLIA_RPC_PRIMARY`, `BASE_SEPOLIA_RPC_FALLBACK`,
      `FACILITATOR_PK`, `BUYER_DEMO_1_PK`, `CLOUDFLARE_API_TOKEN`.

## Step 0 — Preflight (5-probe safety gate)

**Run first. Do not skip.** Four minutes of probing saves hours of
chasing silent failures on live infra.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$DEPLOYER_AWS_SECRET_ACCESS_KEY"
  export AWS_REGION="eu-central-1"
  unset AWS_PROFILE
  node tools/deploy/preflight-l3.mjs
'
```

Must exit 0. Probes:

1. Primary RPC reachable within 5s.
2. Fallback RPC reachable within 5s.
3. KMS deployer derives to `0x66c2…113c` AND sign+recover roundtrip works.
4. `FACILITATOR_PK` derives to `0x0A02…c455` (matches AGENTS.md).
5. Both deployer + facilitator EOAs ≥ 0.01 ETH on Base Sepolia.

If any probe fails, STOP. Fix the root cause (not a workaround) and re-run
preflight. Do NOT proceed to step 1 with a red probe.

## Step 1 — Build contracts

```bash
cd contracts && forge build && cd ..
```

Confirms `contracts/out/Splitter.sol/Splitter.json` exists and is fresh.

## Step 2 — Deploy Splitter (KMS-signed, Base Sepolia)

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$DEPLOYER_AWS_SECRET_ACCESS_KEY"
  export AWS_REGION="eu-central-1"
  unset AWS_PROFILE
  SPLITTER_ADDRESS=$(node tools/deploy/deploy-splitter.mjs)
  echo "Deployed Splitter: $SPLITTER_ADDRESS"
'
```

The script also writes `contracts/deploy-logs/splitter-base-sepolia-<date>.md`.

**Record the Splitter address.** You'll paste it into `wrangler.toml`
files below AND into `AGENTS.md` "## L3 deployments".

## Step 3 — Create the D1 database

```bash
cd workers/facilitator
wrangler d1 create reckon402-d1-facilitator-dev
# Copy the `database_id` from the output into wrangler.toml's
# [[d1_databases]] block (replace the placeholder comment).
```

Then apply the schema:

```bash
wrangler d1 migrations apply reckon402-d1-facilitator-dev --remote
```

## Step 4 — Put facilitator worker secrets

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  echo "$FACILITATOR_PK" | wrangler secret put FACILITATOR_PK
  echo "$BASE_SEPOLIA_RPC_PRIMARY" | wrangler secret put BASE_SEPOLIA_RPC_PRIMARY
  echo "$BASE_SEPOLIA_RPC_FALLBACK" | wrangler secret put BASE_SEPOLIA_RPC_FALLBACK
'
```

And set the Splitter address (from step 2) — either via `[vars]` in
`wrangler.toml` (commit-and-deploy) OR via `wrangler secret put`:

```bash
cd workers/facilitator
echo "<SPLITTER_ADDRESS_FROM_STEP_2>" | wrangler secret put SPLITTER_ADDRESS
```

## Step 5 — Deploy the facilitator worker

```bash
cd workers/facilitator
wrangler deploy
```

Verify:

```bash
curl https://facilitator.reckon402.com/healthz
# expect: 200 with { status: "ok", layer: "L3", checks: {...}, ... }
```

## Step 6 — Put agent worker env + deploy

Paste the Splitter address into `workers/agent/wrangler.toml` [vars] as
`SPLITTER_ADDRESS = "0x..."`, OR use `wrangler secret put` as above.

```bash
cd workers/agent
wrangler deploy
```

Verify:

```bash
curl -I https://agent.reckon402.com/research?q=test
# expect: HTTP 402, PAYMENT-REQUIRED header set
#
# Decode the header and confirm accepts[0].payTo equals the Splitter:
curl -s -D- https://agent.reckon402.com/research?q=test \
  | awk 'tolower($1)=="payment-required:" { sub(/^[^:]+:[[:space:]]*/, ""); print $0 }' \
  | base64 -d | python3 -m json.tool
```

## Step 7 — Run the full-flow integration test

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  export SPLITTER_ADDRESS="<ADDRESS_FROM_STEP_2>"
  cd tools/integration-tests
  bash full-flow-l3.sh
'
```

Exit 0 + `results-full-flow-l3-<STAMP>.md` created with:
- paymentId, nonce, tx hash
- Basescan link
- receipt.json showing state=CONFIRMED

## Step 8 — Run the replay integration test

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  export SPLITTER_ADDRESS="<ADDRESS_FROM_STEP_2>"
  cd tools/integration-tests
  bash replay-l3.sh
'
```

Exit 0 + `results-replay-l3-<STAMP>.md` created with:
- Replay paymentId matches the full-flow paymentId
- Replay tx hash matches the full-flow tx hash
- Receipt state unchanged = CONFIRMED

## Step 9 — Capture wrangler tail excerpts

Open two terminals. In one:

```bash
cd workers/facilitator && wrangler tail
```

In another, rerun (step 7) OR a single replay cycle (step 8) to
capture: initial verify, initial settle, replay verify, replay settle
(short-circuit from D1 — look for `X-Reckon402-Replay: true`).

Save captured excerpts to `tools/integration-tests/wrangler-tail-<stamp>.log`.

## Step 10 — Update AGENTS.md + tag

Add under the "## Locks" section a new "## L3 deployments (v1, locked)"
block with:

```markdown
## L3 deployments (v1, locked)

| Item | Value |
| ---- | ----- |
| Splitter (Base Sepolia) | `0x...` |
| Splitter deploy tx      | `0x...` |
| Deploy signer           | `0x66C2858D9A8605957c516a77262Eb66EE6be113C` (KMS `alias/reckon402/mainnet/deployer/evm`) |
| D1 database name        | `reckon402-d1-facilitator-dev` |
| D1 database ID          | `<uuid>` |
| Facilitator worker URL  | `https://facilitator.reckon402.com` |
| Agent worker URL        | `https://agent.reckon402.com` |
```

Commit this separately (or as part of commit 6's integration-tests
commit). Then tag:

```bash
git tag -a L3-our-facilitator-green -m "L3 green: Splitter on Base Sepolia,
Reckon402 Facilitator on D1, agent swapped via env. full-flow + replay
both exit 0 on <DATE>."

git push --follow-tags
```

## Failure protocol

Any failed step → STOP and report. In particular:

- Splitter deploy reverts → `contracts/deploy-logs/` + investigate;
  check deployer balance ≥ 0.01 ETH on Base Sepolia.
- facilitator-worker /healthz reports `down` → check D1 bindings,
  RPC secrets, Splitter address.
- full-flow-l3.sh 402 step fails → agent env vars wrong
  (FACILITATOR_URL, SPLITTER_ADDRESS).
- full-flow-l3.sh 200 step fails → facilitator worker log via
  `wrangler tail`; most common cause is FACILITATOR_PK misformatted
  or facilitator EOA below ETH floor on Base Sepolia.
- replay-l3.sh produces a DIFFERENT tx hash → replay protection is
  BROKEN; STOP and investigate D1 UNIQUE constraint + INSERT OR IGNORE
  behavior against the live D1.
