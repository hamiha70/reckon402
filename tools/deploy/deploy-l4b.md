# L4b₁ Deploy Runbook — ERC-8004 settlement-attestation writes

Operator-driven end-to-end L4b₁ deploy. Lands the first live ERC-8004
`giveFeedback` writes from the facilitator on Base Sepolia, closes the
gateway read/write loop via the cache-invalidate hook.

**Paired spec:** `specs/07-l4b-erc8004-writes.md`.
**Framing locks:** `specs/06-actor-act-matrix.md` (D1–D14).
**Canonical source of acts + signers:** D3, D4, D5 in §4 of the matrix.

All commands assume you start in the repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Pre-conditions

- [ ] Commit `3ca3f88` (feat(L4b1): ERC-8004 settlement-attestation write
      hook) is landed on `main`; working tree is clean.
- [ ] L3 and L4a2 deployments are live and green
      (`curl https://facilitator.reckon402.com/healthz` returns 200;
      `bash tools/integration-tests/resolve-l4a.sh --backend erc8004` exits 0).
- [ ] L3 green tag exists (`L3-our-facilitator-green`). L4a2 tag
      exists (`L4a2-erc8004-reads-green`).
- [ ] Fresh-clone reproducibility: `git clean -fdx && pnpm install &&
      (cd contracts && forge build && forge test) && pnpm -r run test`
      exits 0 with 39 forge + 240 vitest (+ 3 skipped) tests passing.
- [ ] Infisical hydrates the secrets documented in `secrets-l4b.md`
      (same doc this runbook references in every `wrangler secret put`
      step). If any secret is missing, STOP and populate it before
      proceeding — do NOT paste values into ad-hoc shell exports.

---

## Step 0 — Preflight

Reuse the L3 preflight; L4b₁ adds no new chain probes.

```bash
just preflight-l3
```

Must exit 0.

Additionally confirm the pinned agent exists on Base Sepolia:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e \
    "ownerOf(uint256)(address)" 1 \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
```

Expect a non-zero address (the seller EOA that controls agentId=1).
A revert here means agentId=1 does not exist at the pinned upstream
commit — STOP and investigate (re-verify against
`packages/erc-8004-client/src/multichain.ts` UPSTREAM_ABI_COMMIT).

---

## Step 1 — Apply D1 migration 0002

The migration adds `attestations.failure_detail`. Idempotent if
already applied.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler d1 migrations apply reckon402-d1-facilitator-dev --remote
'
```

Verify:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler d1 execute reckon402-d1-facilitator-dev --remote \
    --command "SELECT name FROM pragma_table_info(\"attestations\")"
' | tee /tmp/d1-cols.txt
```

Must list `failure_detail` among the columns. If not, STOP.

---

## Step 2 — Populate Infisical secret (GATEWAY_CACHE_HOOK_TOKEN)

**Do this BEFORE Step 3.** The token MUST match the value already set
on the gateway worker in L4a2. If you don't know the current value,
read it out of the gateway's wrangler secrets store (it's not
recoverable via CLI; if lost, regenerate + redeploy both workers in
the same session — see "Rotation" below).

See `tools/deploy/secrets-l4b.md` for the value-generation / sourcing
procedure.

---

## Step 3 — Put the cache-hook bearer on the facilitator

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  printf "%s" "$GATEWAY_CACHE_HOOK_TOKEN" | wrangler secret put GATEWAY_CACHE_HOOK_TOKEN
'
```

Verify the secret is registered (value is not printed):

```bash
cd workers/facilitator && wrangler secret list | grep GATEWAY_CACHE_HOOK_TOKEN
```

---

## Step 4 — Deploy facilitator with `ENABLE_ERC8004_WRITES="false"`

The current `wrangler.toml` has the flag off. Deploy first with the
flag off so the new code ships without changing on-chain behavior —
any env / bundling / secret issue surfaces cleanly before writes
start.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler deploy
'
```

Capture the deploy output line starting with `Current Version ID:` — record
it for the AGENTS.md L4b₁ section.

Verify:

```bash
curl -s https://facilitator.reckon402.com/healthz | jq '.status, .layer'
# expect: "ok", "L3"
```

Run L3 regression:

```bash
just fullflow-l3
just replay-l3
```

Both must exit 0 — this proves the new bundle didn't regress L3
settle behavior.

If any regression shows up, STOP. `git revert 3ca3f88` on main;
redeploy the previous build; investigate.

---

## Step 5 — Flip the flag and redeploy

Edit `workers/facilitator/wrangler.toml`:

```diff
-ENABLE_ERC8004_WRITES           = "false"
+ENABLE_ERC8004_WRITES           = "true"
```

Commit this change separately (it's the flag-flip commit):

```bash
git commit -am 'deploy(L4b1): flip ENABLE_ERC8004_WRITES=true on production facilitator'
```

Redeploy:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler deploy
'
```

Record the new `Current Version ID:`.

---

## Step 6 — Live smoke: full-flow-l4b.sh

This drives a real settlement, then checks that the attestation tx
landed in D1 and the gateway cache invalidated so the subsequent
reputation read reflects the new count.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd tools/integration-tests
  bash full-flow-l4b.sh
'
```

Must exit 0. The result markdown
(`results-full-flow-l4b-<STAMP>.md`) captures:
- `paymentId` + settlement tx
- Attestation tx hash + Basescan URL
- `x402.amount` BEFORE and AFTER values
- Price-comparison flag (`discount-engaged` | `same-tier` | `unexpected`)

If the comparison shows `unexpected` (AFTER > BEFORE), the cache
probably did NOT invalidate. Check the facilitator's wrangler-tail
for `invalidateGatewayCache_non_2xx` or `invalidateGatewayCache_fetch_failed`
errors. Most common cause: `GATEWAY_CACHE_HOOK_TOKEN` mismatch between
facilitator and gateway.

---

## Step 7 — Wrangler tail capture

Open two terminals. In one:

```bash
just tail-facilitator
```

In the other, re-run the smoke:

```bash
just fullflow-l4b
```

Capture the tail excerpt showing:
- `maybeWriteAttestation_*` log lines (either success sentence or an
  error path, depending on which code path you want to demonstrate)
- The cache-invalidate POST → gateway response

Save to `tools/integration-tests/wrangler-tail-l4b-<STAMP>.log`.

---

## Step 8 — Verify on Basescan

Open `https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713`
— the ReputationRegistry. The most recent tx should be from the
facilitator EOA (`0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`) and its
"Logs" tab should include a `NewFeedback` event with:

- `agentId = 1`
- `clientAddress = 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` (facilitator)
- Tag fields carrying `"payment"` and `"x402-settlement"`

Screenshot this for the demo deck.

---

## Step 9 — AGENTS.md L4b₁ section + tag

(Claude Code does this after the operator reports step 6 + 8 green.)

Append a `## L4b1 ERC-8004 attestation writes (v1, locked)` section
to AGENTS.md with:
- Facilitator version IDs (flag-off deploy + flag-on deploy)
- First live attestation tx hash (from step 6 results md)
- Test counts (forge + pnpm -r test)
- D1 verification command outputs

Then:

```bash
git tag -a L4b1-erc8004-writes-green \
  -m "L4b1 green: facilitator-signed giveFeedback writes live on Base Sepolia.
First tx: <FROM_STEP_6_RESULTS_MD>. Gateway cache-invalidate loop closed.
Full-flow + attestation smoke both exit 0 on <DATE>."
git push --follow-tags
```

---

## Rotation — if `GATEWAY_CACHE_HOOK_TOKEN` is ever lost or needs rotating

The token is a shared bearer between facilitator (caller) and
gateway (server). Rotation requires both sides to change in the
same window:

```bash
# 1. Generate a new token locally.
NEW_TOKEN=$(openssl rand -hex 32)

# 2. Push to Infisical under the same name.
~/Projects/aws_setup_2026/scripts/infisical-secret-put.sh \
  reckon402 dev GATEWAY_CACHE_HOOK_TOKEN "$NEW_TOKEN"

# 3. Put on both workers (shell must have Infisical-hydrated env).
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway && printf "%s" "$GATEWAY_CACHE_HOOK_TOKEN" | wrangler secret put GATEWAY_CACHE_HOOK_TOKEN
'
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator && printf "%s" "$GATEWAY_CACHE_HOOK_TOKEN" | wrangler secret put GATEWAY_CACHE_HOOK_TOKEN
'

# 4. Redeploy both (so both pick up the new secret).
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway && wrangler deploy
'
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator && wrangler deploy
'
```

---

## Failure protocol

- **Migration apply fails** → check you're running against `--remote`,
  not local. If the `failure_detail` column already exists (e.g.,
  re-running the runbook), SQLite will error — inspect `PRAGMA
  table_info` via `wrangler d1 execute` to confirm state, then skip
  step 1 if already applied.
- **Flag-off deploy regresses L3** → `git revert` and investigate. The
  attestation hook should be fully dormant when `ENABLE_ERC8004_WRITES
  = "false"`; any L3 regression means something in the bundle itself
  (dependency pull, import cycle) broke the settle path.
- **Attestation tx does not land** → wrangler tail will surface the
  exact failure mode. Most common: facilitator EOA below ETH floor
  on Base Sepolia (`just seed facilitator 0.1`), or
  `ReputationRegistry` revert (check upstream feedback-tag
  constraints).
- **Cache invalidation fails (AFTER > BEFORE)** → token mismatch.
  Follow "Rotation" above, but with identical values on both sides.
- **Attestation ROW is `reputation_tx='FAILED'`** in D1 → the row
  carries `failure_detail` with the exact revert / RPC message. Log
  it in the run artifact; do NOT manually retry. The failed-row
  idempotency guard (PK on `(payment_id, agent_id)`) means a retry
  requires deleting the D1 row first. Prefer letting the
  (post-hackathon) retry-reconciler handle this class of failure —
  for the hackathon, it's an acceptable open tail.
