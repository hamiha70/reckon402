# L4c Deploy Runbook — Onboarding script + signed-writes gateway + frontend

Operator-driven end-to-end L4c deploy for Spec 08B. Lands the gateway admin
surface (signed `/admin/records`, `/admin/bootstrap`, `/admin/bootstrap/gateway-seed`),
stands up the new `onboard-orchestrator` CF Worker at `app.reckon402.com`
(serving both the `POST /onboard` API and the static frontend via Workers
Assets), and drives the first live onboarding of a fresh SellingAgent via
the 5-step `just onboard` CLI.

Per-key ACL enforcement on merchant records, ENS owner-lookup (Ethereum
Sepolia), and the bootstrap-window one-way door all go live here. The
onboarding flow mints a subname, deploys a Splitter via the 08A factory,
registers an ERC-8004 agentId, writes the x402.* records through the signed
admin API, and transfers subnode ownership to the seller — all in one
`just onboard` invocation.

**Paired spec:** `specs/08b-l4c-onboarding-frontend.md`.
**Framing locks:** `specs/06-actor-act-matrix.md` (D1–D14; unchanged);
`memory/ens_record_ownership_split.md` (Option 2b signed writes, per-key ACL).
**Required prerequisite runbook:** `tools/deploy/deploy-l4c-factory.md` —
Spec 08A MUST be at tag `L4c-factory-green` before this runbook starts.
The orchestrator passes the 08A factory address through to the onboarding
CLI in step 2 of every run; without a deployed factory, `just onboard`
deterministically fails at step 2 with `isDeployed` RPC error.

All commands assume you start in the repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Pre-conditions

- [ ] `L4c-factory-green` tag pushed. `SplitterFactory` address + deploy tx
      hash + deploy block are recorded in
      `AGENTS.md ## L4c SplitterFactory + per-payment resolution`.
- [ ] L4b₁ is live and green (`L4b1-erc8004-writes-green` tag; `just
      fullflow-l4b` exits 0 on current main).
- [ ] Working tree clean on `main`; the L4c 08B feature commit is landed
      (gateway admin routes + owner-lookup + tools/onboard + onboard-orchestrator
      worker + apps/frontend + integration smoke). 63 new vitest cases;
      total workspace: 337 green.
- [ ] Fresh-clone reproducibility: `git clean -fdx && pnpm install &&
      pnpm -r run test` exits 0. Expect the following per-package tallies
      as a sanity floor (regressions mean you're on the wrong branch):
      `tools/onboard` 24/24; `gateway` 85/85; `workers/onboard-orchestrator`
      13/13; `workers/facilitator` 97/97 (unchanged from 08A).
- [ ] Infisical hydrates the following, beyond what L4b₁ and 08A required:
      - `ENS_FUNDER_PK` — the Ethereum Sepolia key that owns
        `reckon402-test.eth` and can sign `setSubnodeOwner` /
        `setResolver` / `setOwner` on the parent node.
      - `RECKON402_DEPLOYER_PK` — Base Sepolia key that calls
        `SplitterFactory.createSplitter` and
        `IdentityRegistry.register`. Reuse of the 08A deployer key
        (EOA `0x66C2858D9A8605957c516a77262Eb66EE6be113C`) is the
        intended path; adding a second key is unnecessary scope.
      - `RECKON402_ONBOARDING_PK` — the signer for
        `/admin/bootstrap` and `/admin/records` Reckon402-owned keys.
        MAY be the same EOA as the deployer; keeping it separate lets
        you rotate ownership without touching the on-chain deployer key.
      - `ETH_SEPOLIA_RPC_PRIMARY` — RPC for `ENSRegistry.owner()`
        (gateway) and `setSubnodeOwner` (orchestrator).
      - `BASE_SEPOLIA_RPC_PRIMARY` — already hydrated from L4b₁ / 08A;
        no change.
- [ ] `reckon402-test.eth` on Ethereum Sepolia is owned by the EOA
      corresponding to `ENS_FUNDER_PK`. Verify with
      `cast call 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
      "owner(bytes32)(address)" $(cast namehash reckon402-test.eth)
      --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"`.
- [ ] A funded demo SellingAgent EOA for the first onboarding (step 8).
      Needs ≥ 0.005 ETH on Base Sepolia (for the eventual paid-call
      flow in smoke step 9). No Ethereum Sepolia balance required —
      the subnode mint + ownership transfer is paid by the funder.

---

## Step 0 — Preflight

```bash
just preflight-l3
```

Must exit 0. This validates the deployer-PK KMS probe + balance + RPC
reachability (shared floor with 08A).

Additionally confirm the ENS funder EOA is funded on Sepolia:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  ENS_FUNDER_EOA=$(node -e "
    const { privateKeyToAccount } = require(\"viem/accounts\");
    console.log(privateKeyToAccount(process.env.ENS_FUNDER_PK).address);
  ")
  echo "ENS funder EOA: $ENS_FUNDER_EOA"
  cast balance "$ENS_FUNDER_EOA" --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"
'
```

Expect ≥ 0.01 ETH on Ethereum Sepolia. Each onboarding burns ~0.003 ETH
in subnode + resolver + final ownership transfer writes; the funder
needs headroom for 3–5 onboardings minimum (demo + rehearsal + retries).

Confirm the 08A factory is reachable:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cast call <SPLITTER_FACTORY_ADDRESS_FROM_08A> "token()(address)" \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
# expect: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

Replace `<SPLITTER_FACTORY_ADDRESS_FROM_08A>` with the address from
`AGENTS.md ## L4c SplitterFactory + per-payment resolution`. If this call
fails, STOP — re-verify 08A landed green before continuing.

---

## Step 1 — Vitest unit gate

```bash
pnpm -r test
```

Must exit 0 across all 18 workspace projects. Expected totals (from the
08B merge commit):

- `tools/onboard` 24/24
- `gateway` 85/85 (was 59 pre-08B; + 9 owner-lookup + 17 admin-records)
- `workers/onboard-orchestrator` 13/13
- `workers/facilitator` 97/97 (unchanged from 08A)
- `workers/agent` 9/9

Any drift from these totals means the branch under test is not the
08B-green commit — STOP and verify `git log --oneline -5`. The L4c 08B
feature commit SHA is: <TBD-after-deploy>.

---

## Step 2 — Apply gateway D1 migration 0003

Migration `gateway/migrations/0003_l4c_signed_writes.sql` adds three
tables (`record_updates`, `ens_owner_cache`, `onboard_progress`) and
one index. Fully idempotent — every `CREATE TABLE` uses `IF NOT EXISTS`
and no existing tables are altered.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway
  wrangler d1 execute reckon402-d1-gateway-dev --remote \
    --file migrations/0003_l4c_signed_writes.sql
'
```

Verify the three tables exist:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway
  wrangler d1 execute reckon402-d1-gateway-dev --remote \
    --command "SELECT name FROM sqlite_master WHERE type=\"table\" AND name IN (\"record_updates\",\"ens_owner_cache\",\"onboard_progress\") ORDER BY name"
'
```

Must return all three rows. If any row is missing, STOP — re-running
the migration is safe (idempotent). Common failure: forgetting
`--remote` (which targets local wrangler state; production D1 is
unchanged).

Sanity-check the UNIQUE replay guard is in place:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway
  wrangler d1 execute reckon402-d1-gateway-dev --remote \
    --command "SELECT sql FROM sqlite_master WHERE name=\"record_updates\""
'
# expect the CREATE TABLE statement to include: UNIQUE (ens_name, nonce)
```

If the UNIQUE constraint is missing, the replay guard is NOT engaged.
STOP — drop and recreate the table (dev D1 only; no production data yet
to lose). Do NOT proceed to step 3 without the replay guard.

---

## Step 3 — Wire `RECKON402_ONBOARDING_EOA` into gateway `wrangler.toml`

`RECKON402_ONBOARDING_EOA` is the public address corresponding to
`RECKON402_ONBOARDING_PK`. It's a non-secret (public chain data) and
lives in `[vars]`, not `wrangler secret put`. Both `[vars]` and
`[env.production.vars]` + `[env.staging.vars]` need the same value —
named envs don't inherit top-level blocks (L4a₁ lesson 1).

Compute the public address:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  node -e "
    const { privateKeyToAccount } = require(\"viem/accounts\");
    console.log(privateKeyToAccount(process.env.RECKON402_ONBOARDING_PK).address);
  "
'
```

Capture: **RECKON402_ONBOARDING_EOA** — <TBD-after-deploy>.

Edit `gateway/wrangler.toml` — all three [vars] blocks:

```diff
 CACHE_TTL_REPUTATION_S            = "300"
-RECKON402_ONBOARDING_EOA          = ""
+RECKON402_ONBOARDING_EOA          = "<RECKON402_ONBOARDING_EOA>"
```

Apply to the top-level `[vars]`, the `[env.production.vars]`, AND the
`[env.staging.vars]` block. Missing any one leaves a deployed env where
the gateway returns 503 `onboarding_eoa_not_configured` on every
`/admin/*` call — visible immediately in step 4's deploy-smoke curl.

Commit:

```bash
git commit -am 'deploy(L4c-onboarding): wire RECKON402_ONBOARDING_EOA into gateway vars'
```

---

## Step 4 — Deploy gateway with new admin routes

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway
  wrangler deploy --env production
'
```

Capture `Current Version ID:` — **gateway 08B version ID:** <TBD-after-deploy>.

Verify admin routes respond (these should 401/422, not 404 — 404 means
the route is not registered):

```bash
# /admin/records with no body should 400 malformed_json, not 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://gateway.reckon402.com/admin/records
# expect: 400

# /admin/bootstrap with no body should 400 malformed_json, not 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://gateway.reckon402.com/admin/bootstrap
# expect: 400

# /admin/bootstrap/gateway-seed with no body should 400 malformed_json, not 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://gateway.reckon402.com/admin/bootstrap/gateway-seed
# expect: 400
```

Any 404 means the route wasn't wired — STOP and inspect
`gateway/src/index.ts` on the deployed worker (`wrangler deployments
list --env production` + diff against main).

Verify L4a regression:

```bash
just fullflow-l4b    # L4b1 attestation smoke MUST still PASS
```

Must exit 0. The admin routes are additive; any regression here means
the gateway bundle lost a route (likely import ordering). If this
fails, STOP — `git revert` the step 3 commit, redeploy the prior
version ID, investigate.

Structured-log sanity-check (one terminal):

```bash
wrangler tail reckon402-gateway --env production --format pretty
```

…and in another terminal, fire a fake /admin/records to confirm the ACL
path logs the expected fields. (Expect 401 `invalid_signature` — we
haven't built a signer harness yet, that's fine.)

```bash
curl -s -X POST https://gateway.reckon402.com/admin/records \
  -H 'Content-Type: application/json' \
  -d '{"ensName":"fake.reckon402-test.eth","key":"x402.amount","value":"1","nonce":"0xdead","signature":"0xdead"}'
# expect: 401 {"error":"invalid_signature"} (after shape validation; 422 also acceptable if your local validator trips first)
```

Tail should show the request without crashing the worker.

---

## Step 5 — Configure onboard-orchestrator secrets

The orchestrator holds THREE private keys (`ENS_FUNDER_PK`,
`RECKON402_DEPLOYER_PK`, `RECKON402_ONBOARDING_PK`) plus two RPCs.
All via `wrangler secret put`, all Infisical-piped.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/onboard-orchestrator

  printf "%s" "$ENS_FUNDER_PK"           | wrangler secret put ENS_FUNDER_PK           --env production
  printf "%s" "$RECKON402_DEPLOYER_PK"   | wrangler secret put RECKON402_DEPLOYER_PK   --env production
  printf "%s" "$RECKON402_ONBOARDING_PK" | wrangler secret put RECKON402_ONBOARDING_PK --env production
  printf "%s" "$ETH_SEPOLIA_RPC_PRIMARY" | wrangler secret put ETH_SEPOLIA_RPC_PRIMARY --env production
  printf "%s" "$BASE_SEPOLIA_RPC_PRIMARY"| wrangler secret put BASE_SEPOLIA_RPC_PRIMARY --env production
'
```

`printf "%s"` (no trailing newline) — if you pipe `echo`, some shells
append `\n` which corrupts the hex key. Check with
`wrangler secret list --env production` after — expect five secrets.

Verify no trailing-newline corruption by probing from a tail:

```bash
wrangler tail reckon402-onboard-orchestrator --env production --format pretty
```

(The `/healthz` probe in the next step will echo `ok` only if D1 is
bound AND secrets aren't obviously broken. Secret content isn't
directly verifiable; the first `just onboard` call in step 8 is the
full end-to-end proof.)

---

## Step 6 — Wire orchestrator `wrangler.toml` vars

`workers/onboard-orchestrator/wrangler.toml` ships with empty
`SPLITTER_FACTORY_ADDRESS` and `RECKON402_ONBOARDING_EOA` — the
orchestrator is useless until both are set.

Edit both the top-level `[vars]` AND `[env.production.vars]`:

```diff
-SPLITTER_FACTORY_ADDRESS = ""
-RECKON402_ONBOARDING_EOA = ""
+SPLITTER_FACTORY_ADDRESS = "<SPLITTER_FACTORY_ADDRESS_FROM_08A>"
+RECKON402_ONBOARDING_EOA = "<RECKON402_ONBOARDING_EOA_FROM_STEP_3>"
 GATEWAY_BASE_URL         = "https://gateway.reckon402.com"
 FACILITATOR_BASE_URL     = "https://facilitator.reckon402.com"
 CHAIN_ID_BASE_SEPOLIA    = "84532"
```

Use the same `RECKON402_ONBOARDING_EOA` value from step 3 — this is
the critical consistency constraint. If the gateway trusts address A
but the orchestrator signs with the PK for address B, every
`/admin/bootstrap` call from step 8's onboarding returns 403
`forbidden`.

Commit:

```bash
git commit -am 'deploy(L4c-onboarding): wire orchestrator factory + onboarding EOA vars'
```

---

## Step 7 — Deploy orchestrator worker + DNS

Initial deploy exposes the worker at `reckon402-onboard-orchestrator.<acct>.workers.dev`.
The custom domain route in `wrangler.toml` (pattern `app.reckon402.com`)
binds on deploy; Cloudflare provisions the cert automatically if the
zone's DNS has a valid proxied record pointing at the worker.

Build the frontend static bundle (no-op — the `apps/frontend/dist/`
tree is committed, no build step):

```bash
ls apps/frontend/dist
# expect: index.html  app.js
```

Deploy:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/onboard-orchestrator
  wrangler deploy --env production
'
```

Capture `Current Version ID:` — **orchestrator 08B version ID:** <TBD-after-deploy>.

Deploy output includes an `Upload size` line covering the Workers Assets
bundle; expect ~12–18 KB (just `index.html` + `app.js`). If you see
"0 B uploaded to static assets" the `[assets]` block in
`wrangler.toml` is misconfigured (`directory` pointing at a missing
path).

DNS: create a CNAME record in the `reckon402.com` zone.

- **Name:** `app`
- **Target:** `reckon402-onboard-orchestrator.<account>.workers.dev`
  (or any CF-managed origin; the worker route binding handles the actual
  routing). If `wrangler deploy` output already says `✨ Bound to
  app.reckon402.com`, DNS is already wired by the `custom_domain = true`
  directive — verify with `dig app.reckon402.com`.
- **Proxy status:** Proxied (orange cloud).
- **TTL:** Auto.

Verify reachability:

```bash
curl -s https://app.reckon402.com/healthz
# expect: {"ok":true}

curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" https://app.reckon402.com/
# expect: 200 https://app.reckon402.com/
# (Workers Assets serves index.html)

curl -s -o /dev/null -w "%{http_code}\n" https://app.reckon402.com/app.js
# expect: 200
```

Open `https://app.reckon402.com/` in a browser — you should see the
onboarding form with the "Deploy SellingAgent" button. If you see a
404 page, the `[assets]` binding is not wired — check
`not_found_handling = "single-page-application"` is in the deployed
config.

Smoke the API from the browser console:

```javascript
await fetch('/onboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'dryrun', sellerEoa: '0x1', endpoint: '', amount: '' })
}).then(r => r.status)
// expect: 422 (malformed — validation engaged, route is live)
```

---

## Step 8 — First live onboarding

From the repo root. Requires a funded SellingAgent EOA (see pre-conditions).

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  just onboard seller9.reckon402-test.eth <SELLER_EOA>
'
```

Replace `<SELLER_EOA>` with the demo SellingAgent's address (0x...).
Optional: append a custom `endpoint` (default:
`https://agent.reckon402.com/research`) and `amount` (default:
`100000` = 0.10 USDC).

Expected output — five JSON blobs (one per step start and end), then a
final result blob. Total runtime: ~45–75 s (three chain txs + three
gateway admin calls).

Capture from the final result:

- **onboardId (CLI doesn't surface this; orchestrator run was CLI-direct, no onboard_progress row).**
- **agentId** — <TBD-after-deploy>
- **splitter address** — <TBD-after-deploy>
- **splitter deploy tx** — <TBD-after-deploy>
- **subname register tx** — <TBD-after-deploy>
- **agent register tx** — <TBD-after-deploy>
- **final setOwner tx (subnode → seller)** — <TBD-after-deploy>

Verify the gateway now serves the records:

```bash
bash tools/integration-tests/resolve-l4a.sh \
  --gateway https://gateway.reckon402.com \
  --name seller9.reckon402-test.eth \
  --key x402.splitter
# expect: {"value":"0x<splitter>"}

bash tools/integration-tests/resolve-l4a.sh \
  --gateway https://gateway.reckon402.com \
  --name seller9.reckon402-test.eth \
  --key x402.erc8004.agent_id
# expect: {"value":"<agentId>"}

bash tools/integration-tests/resolve-l4a.sh \
  --gateway https://gateway.reckon402.com \
  --name seller9.reckon402-test.eth \
  --key x402.amount
# expect: {"value":"100000"}
```

Verify the seller now owns the ENS subnode:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cast call 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
    "owner(bytes32)(address)" \
    $(cast namehash seller9.reckon402-test.eth) \
    --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"
'
# expect: <SELLER_EOA>
```

If owner is still the funder EOA, step 5 of onboarding (final
`setOwner`) did not execute — inspect the CLI output for the step 5
blob. A common cause: the `/admin/bootstrap/gateway-seed` call returned
non-200, which aborts the step before the ownership transfer.

Alternative: drive the same onboard via the frontend at
`https://app.reckon402.com/` — fill the form, click Deploy, watch the
five progress steps complete in the panel, redirect to
`#/agent/seller9.reckon402-test.eth`.

---

## Step 9 — Automated smoke: fullflow-l4c-onboard

This drives a separate-named SellingAgent end-to-end: fresh onboard →
gateway records verified → paid call via L4b₁ flow → post-attestation
discount reflected in `x402.amount?backend=erc8004`.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  SELLER_DEMO_1_PK=$SELLER_DEMO_1_PK \
  just fullflow-l4c-onboard
'
```

Must exit 0. Run log at
`tools/integration-tests/run-full-flow-l4c-onboard-<STAMP>.log`.

The smoke onboards `seller${unix_timestamp}.reckon402-test.eth` — a
fresh name per run, so re-running doesn't collide with step 8's
`seller9`. Capture from the log:

- **Smoke ENS name** — `seller<STAMP>.reckon402-test.eth`
- **onboardId** — <TBD-after-deploy>
- **Post-attestation x402.amount** — <TBD-after-deploy> (expect 95000
  if tier-0 discount kicks in after 1 attestation; actual value
  depends on the tier schedule in `demo_narrative.md`).

If the smoke fails at step B (poll /onboard/:id/status), the
orchestrator is deployed but step 6 vars aren't consistent — the
Reckon402 signature recovered from `/admin/bootstrap` won't match the
gateway's `RECKON402_ONBOARDING_EOA` and the bootstrap returns 403. Fix
by re-running step 6 with the correct address and redeploying.

If the smoke fails at step D (paid call), the 08A factory resolution
is failing — verify
`SPLITTER_FACTORY_ADDRESS` in the facilitator's wrangler vars matches
the one in the orchestrator's vars. Both must point at the same
deployed factory.

---

## Step 10 — Wrangler tail capture

In two terminals:

```bash
# terminal 1
wrangler tail reckon402-gateway --env production --format pretty

# terminal 2
wrangler tail reckon402-onboard-orchestrator --env production --format pretty
```

In a third, re-run the smoke:

```bash
just fullflow-l4c-onboard
```

Capture tails showing:

- Orchestrator: `POST /onboard` with exact body (ensName, sellerEoa),
  `progressSink` emissions step 1–5, `complete` write to
  `onboard_progress`.
- Gateway: `/admin/bootstrap` with 200 + keys written; `/admin/bootstrap/gateway-seed`
  with 200 + chain/agentId; no `forbidden` or `invalid_signature`
  lines (those are the common-failure signals).

Save both to
`tools/integration-tests/wrangler-tail-l4c-onboarding-<STAMP>.log`.

---

## Step 11 — AGENTS.md + annotated tag

(Claude Code fills this in after the operator reports steps 8 + 9 green.)

Extend the `## L4c Onboarding + signed writes + frontend (Spec 08B)`
section already in AGENTS.md with:

- Gateway version ID (from step 4)
- Orchestrator version ID (from step 7)
- `RECKON402_ONBOARDING_EOA` (public address, from step 3)
- First live onboarding: ENS name, agentId, splitter address, the five
  tx hashes (from step 8)
- Smoke run result: ENS name, onboardId, pre/post x402.amount (from
  step 9)

Then:

```bash
git tag -a L4c-onboarding-green \
  -m "L4c 08B green: gateway admin routes live (/admin/records + /admin/bootstrap
+ /admin/bootstrap/gateway-seed with per-key ACL + owner-lookup cache);
onboard-orchestrator worker live at app.reckon402.com serving both the
API and the frontend via Workers Assets. First live onboarding:
<FROM_STEP_8_RESULTS>. Automated smoke: <FROM_STEP_9_RESULTS>.
Full-flow + post-attestation discount smoke exits 0 on <DATE>."
git push --follow-tags
```

---

## Rollback protocol

The 08B changes are largely additive and do NOT change the on-chain
settle path. Rollback is cleaner than 08A's (no flag to flip — the
routes either exist or don't).

1. **Fastest rollback (gateway admin path):** redeploy the pre-08B
   gateway version from CF's deployment history:

   ```bash
   wrangler rollback <previous_version_id> --env production
   ```

   (Use the version ID from `L4b1-erc8004-writes-green` or the 08A
   flag-on gateway — whichever was last green.) The admin routes
   become 404; any in-flight onboarding fails at step 4 (set-ens-records).
   The D1 tables from migration 0003 stay — they're orphaned but
   harmless.

2. **Orchestrator rollback:** the orchestrator is a net-new worker.
   Disable it by removing the `app.reckon402.com` custom-domain
   binding in `wrangler.toml` and redeploying, OR simply
   `wrangler delete reckon402-onboard-orchestrator` — no downstream
   consumer depends on it being live.

3. **DNS rollback:** leave `app.reckon402.com` CNAME in place unless
   you're seeing cert issues — Cloudflare handles the route-binding
   teardown gracefully when the worker is removed.

4. **D1 rollback:** do NOT drop `record_updates` or `ens_owner_cache`
   or `onboard_progress`. They're additive, replay-guarding, and
   preserving them preserves the audit trail of any admin calls that
   already landed. If you absolutely must wipe (dev D1 only, never
   production with real records):

   ```bash
   wrangler d1 execute reckon402-d1-gateway-dev --remote \
     --command "DROP TABLE record_updates; DROP TABLE ens_owner_cache; DROP TABLE onboard_progress"
   ```

5. **ENS rollback:** an onboarded subnode (e.g., `seller9.reckon402-test.eth`)
   that you want to reclaim can be transferred back with the funder key:

   ```bash
   # as the funder AFTER the seller re-grants ownership back to funder
   cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
     "setOwner(bytes32,address)" \
     $(cast namehash seller9.reckon402-test.eth) 0x0000000000000000000000000000000000000000 \
     --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY" --private-key "$ENS_FUNDER_PK"
   ```

   Note: once the seller owns the node, only the seller can transfer.
   Unburning an onboarding is an explicit counterparty operation.

6. **On-chain artifacts (splitters, agentIds):** cannot be rolled back.
   The L4b₁ + 08A code ignores them if no ENS records point at them.

---

## Failure protocol

- **Migration apply fails with "table already exists"** → you're running
  against the wrong D1. Confirm `--remote` targets
  `reckon402-d1-gateway-dev` (same DB as L4a₁/L4a₂). `IF NOT EXISTS`
  should prevent this, but a partial migration from an aborted run
  could leave state — inspect with
  `wrangler d1 execute reckon402-d1-gateway-dev --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`.

- **`curl gateway.reckon402.com/admin/records` returns 404** → the
  route is not registered in the deployed bundle. Check `main`
  matches the 08B feature commit; `wrangler deployments list --env production`
  shows the current bundle metadata. Redeploy with
  `wrangler deploy --env production` from the correct branch.

- **`/admin/bootstrap` returns 503 `onboarding_eoa_not_configured`** →
  `RECKON402_ONBOARDING_EOA` is empty-string in the deployed `[vars]`.
  Either step 3 skipped the `[env.production.vars]` block, or the
  deploy didn't pick up the commit. Inspect with
  `wrangler deployments list --env production` + diff against the repo.

- **`/admin/bootstrap` returns 403 `forbidden`** → the onboarding
  signature recovered to a different address than `RECKON402_ONBOARDING_EOA`.
  Either the orchestrator's `RECKON402_ONBOARDING_PK` secret is the
  wrong key, OR the gateway's `RECKON402_ONBOARDING_EOA` var is the
  wrong address. They must be a matched pair: address = address of
  keypair corresponding to PK. Fix step 5 (orchestrator secrets) or
  step 3 (gateway var), redeploy.

- **Step 1 of onboarding (mint subname) fails with "insufficient
  funds"** → the ENS funder EOA is out of Ethereum Sepolia ETH. Refill
  from the L4a₁ funder EOA per the `tools/funding/check-balances.mjs`
  conventions. Each subname mint + final ownership transfer is
  ~0.002–0.003 ETH.

- **Step 2 of onboarding (deploy splitter) fails with "AlreadyDeployed"
  revert** → you're onboarding an ENS name for which a Splitter with
  the identical (recipients, bps, salt) tuple already exists on-chain.
  This is expected on a re-onboard; the `deploy-splitter.ts` step has
  `isDeployed` idempotency, so this revert means the check failed.
  Most likely cause: you're running against a freshly-redeployed
  factory and the old splitter is orphaned but not indexed. Either
  change the ENS name (new salt) or change the recipients/bps.

- **Step 3 of onboarding (register agentId) succeeds but `agentId`
  returns as 0** → the Transfer log decoder in
  `register-agent-id.ts` didn't find the ERC-721 mint event. Likely
  cause: the `IdentityRegistry` upstream ABI changed. Re-verify
  against the pinned commit `0463311492b3a7fc5fdb6990231cce721ff6cf97`.

- **Step 4 of onboarding (set-ens-records) fails with 409 `replay`** →
  the onboarding ran once partially, committed the `_bootstrap` row
  in `record_updates`, then failed downstream. On re-run, the same
  nonce collides. Re-running is fine — the CLI generates a fresh
  nonce per invocation; if you see this persistently, inspect
  `record_updates` for a row with the reused nonce and investigate
  who signed it.

- **Step 5 of onboarding (seed-gateway + setOwner) fails after
  /gateway-seed 200** → the ENS funder key lost ownership of the
  subnode mid-run (no known race, but possible if someone manually
  called `setOwner` from a console). Inspect
  `cast call ENSRegistry owner(bytes32)` — if the current owner is
  NOT the funder, the final transfer cannot execute. Manual recovery:
  the seller (new owner) can re-run a setOwner transfer themselves
  or return ownership to the funder.

- **Frontend shows "no calls yet" forever after the test-call button
  click** → the button currently only displays a shell-command hint
  (Q-08B-1 in the spec is explicit: no browser-side signing in v1).
  The facilitator's `/admin/receipts` call does work from the
  frontend, so a real paid-call via `full-flow-l4b.sh --merchant`
  from the shell DOES populate the log on the next 3s poll.

- **Workers Assets returns index.html for /app.js** → `not_found_handling`
  is set incorrectly (or to `"404"`). Confirm
  `not_found_handling = "single-page-application"` in the deployed
  wrangler config via `wrangler deployments view <id> --env production`.

---

## References

- `specs/08b-l4c-onboarding-frontend.md` — spec (§3 onboarding flow,
  §4 gateway admin endpoints, §5 D1 migration, §6 frontend, §7 tests).
- `specs/08a-l4c-factory-refactor.md` — 08A spec (prerequisite).
- `memory/ens_record_ownership_split.md` — per-key ACL model (Option 2b).
- `memory/demo_narrative.md` — one-SellingAgent trust-growth loop,
  Option C terminal pane non-negotiable.
- `memory/feedback_testing.md` — full-arg assertion rule used
  throughout the 08B vitest suite.
- `tools/onboard/src/` — CLI + 5 step modules + orchestrator.
- `workers/onboard-orchestrator/src/` — HTTP surface + progress store.
- `gateway/src/routes/admin/` — signed-write endpoints.
- `gateway/src/ens/owner-lookup.ts` — `ENSRegistry.owner()` reader.
- `apps/frontend/dist/` — static bundle (served via Workers Assets).
- `tools/integration-tests/full-flow-l4c-onboard.sh` — smoke driver.
- `tools/deploy/deploy-l4c-factory.md` — 08A runbook (prerequisite; this
  runbook assumes `L4c-factory-green` has shipped).
- `tools/deploy/deploy-l4b.md` — L4b₁ runbook (inherited wrangler +
  Infisical conventions).
