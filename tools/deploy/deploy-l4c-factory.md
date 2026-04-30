# L4c Deploy Runbook — SplitterFactory + per-payment splitter resolution

Operator-driven end-to-end L4c deploy. Lifts the single-`SPLITTER_ADDRESS`-
per-facilitator constraint by landing a `SplitterFactory` on Base Sepolia
and flipping the facilitator to resolve per-SellingAgent Splitters via the
gateway at payment time. The Splitter-write + x402 settle path is
unchanged on the hot path; attestation writes start reading `agentId` from
the ENS record instead of the `SELLER_AGENT_IDS` JSON map.

**Paired spec:** `specs/08a-l4c-factory-refactor.md`.
**Framing locks:** `specs/06-actor-act-matrix.md` (D1–D14; unchanged).
**Companion runbook (not run here):** Spec 08B's onboarding script +
signed-writes gateway runbook — this deploy ships only the on-chain +
facilitator substrate it needs.

All commands assume you start in the repo root:

```bash
cd ~/Projects/ETHGlobal/ETHGlobal_OpenAgents_2026/reckon402
```

---

## Pre-conditions

- [ ] L4b₁ is live and green (`L4b1-erc8004-writes-green` tag pushed;
      `bash tools/integration-tests/full-flow-l4b.sh` exits 0 on the
      current main).
- [ ] Working tree clean on `main`; the L4c feature commit is landed
      (contracts + facilitator worker + vitest + forge tests — 97/97
      vitest + 10/10 forge on `SplitterFactoryTest`).
- [ ] Fresh-clone reproducibility: `git clean -fdx && pnpm install &&
      (cd contracts && forge build && forge test) && pnpm -r run test`
      exits 0. The new forge suite adds `SplitterFactoryTest` (10
      tests, including 256-case fuzz on salt).
- [ ] Infisical hydrates `BASE_SEPOLIA_RPC_PRIMARY`,
      `DEPLOYER_PK` (KMS alias `alias/reckon402/mainnet/deployer/evm`,
      EOA `0x66C2858D9A8605957c516a77262Eb66EE6be113C`),
      `BUYER_DEMO_1_PK`, and the L4b₁ secrets already pushed
      (`FACILITATOR_PK`, `GATEWAY_CACHE_HOOK_TOKEN`).
- [ ] Gateway worker is serving `GET /lookup/:ensName/:key?backend=static`
      with the `x402.splitter` and `x402.erc8004.agent_id` records
      populated for at least one SellingAgent. **Spec 08B owns this
      step;** if 08B has not yet shipped, you can still complete steps
      0–3 of this runbook (factory deploy + flag-off facilitator
      deploy) and HOLD at step 4 until the gateway is ready.

---

## Step 0 — Preflight

Reuse the L3 preflight; L4c adds no new chain probes beyond the
SplitterFactory deploy signer balance check.

```bash
just preflight-l3
```

Must exit 0.

Additionally confirm the deployer EOA is funded:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cast balance 0x66C2858D9A8605957c516a77262Eb66EE6be113C \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
```

Expect ≥ 0.02 ETH. SplitterFactory deploy is ~0.002 ETH of gas; the
funding floor inherits the L3 budget.

---

## Step 1 — Forge unit gate

```bash
(cd contracts && forge test --match-contract SplitterFactoryTest -vv)
```

Must exit 0 with 10/10 passing (including the 256-case fuzz). Any
fuzz failure is a STOP — investigate the salt/CREATE2 math before
broadcasting.

---

## Step 2 — Deploy SplitterFactory on Base Sepolia

USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
(canonical source: `AGENTS.md` §L3 deployments).

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd contracts
  SPLITTER_FACTORY_TOKEN=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  forge script script/DeploySplitterFactory.s.sol:DeploySplitterFactory \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
    --private-key "$DEPLOYER_PK" \
    --broadcast \
    -vvv
' | tee /tmp/l4c-factory-deploy.log
```

Capture from the `[logs]` or `Deployed at:` block:

- **SplitterFactory address** — <TBD-after-deploy>
- **Deploy tx hash** — <TBD-after-deploy>
- **Block number** — <TBD-after-deploy>

Verify on Basescan:

```
https://sepolia.basescan.org/address/<SPLITTER_FACTORY_ADDRESS>
```

Sanity read:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cast call <SPLITTER_FACTORY_ADDRESS> "token()(address)" \
    --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"
'
# expect: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

Record the factory address in `AGENTS.md ## L4c SplitterFactory +
per-payment resolution` (the spec-green commit will wire this into
`deployment_config` + the wrangler vars).

---

## Step 3 — Apply D1 migration 0003 + record factory address

Migration `workers/facilitator/migrations/0003_l4c_splitter_factory.sql`
adds the `deployment_config` table. Idempotent.

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
    --command "SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"deployment_config\""
'
```

Must return the `deployment_config` row. If not, STOP.

Seed the factory address row (audit + cold-start logging; the worker
reads `SPLITTER_FACTORY_ADDRESS` from wrangler `[vars]`, not this row,
but the row is the durable receipt of which factory is authoritative
for this D1 database):

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler d1 execute reckon402-d1-facilitator-dev --remote \
    --command "INSERT OR REPLACE INTO deployment_config (key, value, updated_at) VALUES (\"splitter_factory_address\", \"<SPLITTER_FACTORY_ADDRESS>\", strftime(\"%s\",\"now\")*1000)"
'
```

Replace `<SPLITTER_FACTORY_ADDRESS>` with the address from step 2.

---

## Step 4 — Update `wrangler.toml [vars]` with the factory address

Edit `workers/facilitator/wrangler.toml`:

```diff
-SPLITTER_FACTORY_ADDRESS        = ""
+SPLITTER_FACTORY_ADDRESS        = "<SPLITTER_FACTORY_ADDRESS>"
 GATEWAY_BASE_URL                = "https://gateway.reckon402.com"
 ENABLE_L4C_FACTORY              = "false"
 USE_LEGACY_AGENT_RESOLVER       = "true"
```

`SPLITTER_FACTORY_ADDRESS` is a non-secret `[vars]` entry — do NOT use
`wrangler secret put` for it. (Secrets are for PKs and bearer tokens;
the factory address is public chain data and belongs in committed
configuration.)

Commit as its own change (no flag flip yet — regression-safe deploy):

```bash
git commit -am 'deploy(L4c): wire SPLITTER_FACTORY_ADDRESS into facilitator vars'
```

---

## Step 5 — Deploy facilitator with `ENABLE_L4C_FACTORY="false"`

Ships the new bundle with L4c code paths dormant — any env / bundling
/ type issue surfaces cleanly before per-payment resolution starts.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler deploy
'
```

Capture `Current Version ID:` — **flag-off version ID:** <TBD-after-deploy>.

Verify health + L4b₁ regression:

```bash
curl -s https://facilitator.reckon402.com/healthz | jq '.status, .layer'
# expect: "ok", <existing layer string from L4b1>

just fullflow-l4b     # L4b1 attestation smoke must still PASS
just fullflow-l3      # L3 settle smoke must still PASS
just replay-l3        # replay idempotency must still PASS
```

All three must exit 0. **If any fail, STOP** — `git revert` the
wrangler.toml commit + the L4c code commit; redeploy the previous
build; investigate before proceeding. L4c landing must never be
load-bearing on a fresh bundle that has not been regression-cleared.

---

## Step 6 — Flip `ENABLE_L4C_FACTORY="true"` and redeploy

Edit `workers/facilitator/wrangler.toml`:

```diff
-ENABLE_L4C_FACTORY              = "false"
+ENABLE_L4C_FACTORY              = "true"
```

Commit separately (this is the flag-flip commit):

```bash
git commit -am 'deploy(L4c): flip ENABLE_L4C_FACTORY=true on production facilitator'
```

Redeploy:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler deploy
'
```

Capture `Current Version ID:` — **flag-on version ID:** <TBD-after-deploy>.

At this point the facilitator reads `paymentRequirements.extra.ens` on
every `/x402/settle` call and resolves the Splitter per-payment via the
gateway. The L4b₁ JSON-map fallback still covers attestation writes
(because `USE_LEGACY_AGENT_RESOLVER="true"` is still set) — this is
intentional. We only drop the legacy fallback after step 7 smoke
passes.

---

## Step 7 — Live smoke: full-flow-l4c-factory.sh

This drives a real settlement through the L4c resolver path, plus a
forged-splitter negative case that must return HTTP 422 without
burning any gas.

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd tools/integration-tests
  bash full-flow-l4c-factory.sh
'
```

Must exit 0. The result markdown
(`results-full-flow-l4c-factory-<STAMP>.md`) captures:

- **Scenario A (happy path):** `paymentId` + settlement tx + attestation
  tx; proves that `ENABLE_L4C_FACTORY="true"` routes through the
  resolver and the Splitter used was the per-SellingAgent one
  (from ENS `x402.splitter`), not `env.SPLITTER_ADDRESS`.
- **Scenario B (forged splitter):** a `paymentRequirements.extra.ens`
  pointing at a SellingAgent whose `x402.splitter` record has been
  rewritten to a non-factory address. Facilitator must return HTTP
  422 `{error: "splitter_unknown"}` and the D1 receipt row must
  transition SUBMITTED → SPLITTER_UNKNOWN with no `transaction`
  populated.

If scenario A fails with `splitter_unknown` when you expect success,
check:

1. The ENS record actually resolves: `bash tools/integration-tests/resolve-l4a.sh
   --backend static --key x402.splitter --name <seller>.reckon402-test.eth`
2. The splitter address returned is in fact from this factory:
   `cast call <SPLITTER_FACTORY_ADDRESS> "isDeployed(address)(bool)" <splitter>
   --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY"` — must return `true`.

If scenario B returns 200 instead of 422, the `isDeployed` guard is
NOT engaging — STOP and inspect wrangler tail for `resolve_*` log
lines; most likely cause is the gateway base URL pointing at a worker
that still serves the unchecked record from cache.

---

## Step 8 — Flip `USE_LEGACY_AGENT_RESOLVER="false"` and redeploy

Only after step 7 is green on both scenarios. This drops the L4b₁
JSON-map fallback — from here on, attestation writes use
`agentId` directly from the gateway (`resolved.agentId`) and
`SELLER_AGENT_IDS` is dead config.

```diff
-USE_LEGACY_AGENT_RESOLVER       = "true"
+USE_LEGACY_AGENT_RESOLVER       = "false"
```

```bash
git commit -am 'deploy(L4c): flip USE_LEGACY_AGENT_RESOLVER=false — factory-only attestation resolution'

infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/facilitator
  wrangler deploy
'
```

Capture `Current Version ID:` — **legacy-off version ID:** <TBD-after-deploy>.

Re-run the L4c smoke:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd tools/integration-tests
  bash full-flow-l4c-factory.sh
'
```

Must exit 0 with both scenarios green. If scenario A fails with no
attestation tx landing (`receipts.td_erc8004_tx = null`), the ENS
record for `x402.erc8004.agent_id` is missing or malformed — verify
with `resolve-l4a.sh --backend static --key x402.erc8004.agent_id`.

---

## Step 9 — Wrangler tail capture

Open two terminals. In one:

```bash
just tail-facilitator
```

In the other, re-run the smoke:

```bash
just fullflow-l4c-factory      # if this recipe exists by the time you run it;
                                # otherwise: bash tools/integration-tests/full-flow-l4c-factory.sh
```

Capture the tail excerpt showing:

- `resolve_missing_record` / `resolve_splitter_not_from_factory`
  (from scenario B)
- Successful per-payment resolution log line on scenario A (splitter
  address + agentId in structured fields)
- `maybeWriteAttestation` using `input.resolved.agentId` (no
  `resolveAgentId_*` legacy log lines)

Save to `tools/integration-tests/wrangler-tail-l4c-<STAMP>.log`.

---

## Step 10 — AGENTS.md L4c section + annotated tag

(Claude Code does this after the operator reports steps 7 + 8 green.)

Extend the existing `## L4c SplitterFactory + per-payment resolution`
section in AGENTS.md with:

- SplitterFactory address + deploy tx + deploy block (from step 2)
- Facilitator version IDs (flag-off, flag-on, legacy-off; from steps 5/6/8)
- First live payment routed via the factory path: `paymentId`,
  settlement tx, attestation tx (from step 7 scenario A result md)
- First live `SPLITTER_UNKNOWN` receipt: `paymentId`, ensName
  (from step 7 scenario B result md)
- Test counts (forge `SplitterFactoryTest` 10/10; vitest 97/97)

Then:

```bash
git tag -a L4c-factory-green \
  -m "L4c green: SplitterFactory live on Base Sepolia; facilitator resolves
per-SellingAgent Splitter per payment via x402.splitter ENS record +
factory isDeployed check. Forged-record path returns 422 with zero gas
spent. First factory-routed payment: <FROM_STEP_7_RESULTS_MD>.
Full-flow + forged-negative smoke both exit 0 on <DATE>."
git push --follow-tags
```

---

## Rollback protocol

If any post-deploy regression surfaces (e.g., the gateway cache
starts serving stale factory addresses across SellingAgents, or the
facilitator starts rejecting valid payments with `SPLITTER_UNKNOWN`),
the rollback sequence is:

1. **Fastest rollback (no redeploy needed):** flip
   `ENABLE_L4C_FACTORY` back to `"false"` and redeploy the facilitator.
   This reverts the whole request path to the L4b₁ singleton-splitter
   behavior. `USE_LEGACY_AGENT_RESOLVER` must be `"true"` simultaneously
   — if you dropped it in step 8, restore it in the same commit.
2. **Factory address fix:** if the issue is a bad factory address in
   `deployment_config` or `wrangler.toml`, correct both and redeploy.
   The on-chain factory itself cannot be "rolled back" — deploy a
   fresh factory if the previous one has a demonstrated contract bug
   (unlikely; the factory is ~90 LOC with 10/10 test coverage).
3. **D1 state:** `SPLITTER_UNKNOWN` rows do NOT require a schema
   rollback — they are terminal receipts, outside the reconciler's
   sweep scope. Leave them in place as audit evidence.

Do NOT attempt to delete rows from `attestations` or `receipts` as
part of a rollback — the idempotency guards rely on those rows
existing.

---

## Failure protocol

- **Forge fuzz fails** → STOP at step 1. A CREATE2 prediction drift
  means the `predictAddress` implementation disagrees with the EVM's
  actual deployed address; never broadcast a factory that fails this
  test. Investigate `contracts/src/SplitterFactory.sol` `predictAddress`
  against `cast create2` for a golden-vector.
- **Migration apply fails** → check you're running against `--remote`.
  The `deployment_config` table is created with `IF NOT EXISTS`, so
  re-running is safe.
- **Flag-off deploy regresses L4b₁** → `git revert` the code commit
  AND the wrangler.toml commit; redeploy the previous build. The L4c
  code paths are fully dormant when the flag is off, so any regression
  here is a bundle-level issue (dependency pull, import cycle).
- **Scenario B returns 200 instead of 422** → the `isDeployed` guard
  is not engaging. Most common cause: wrangler tail shows
  `resolve_unsupported_chain` (chainId mismatch — confirm
  `ERC8004_CHAIN_ID="84532"` in wrangler.toml) or `resolve_factory_rpc_error`
  (the worker cannot reach `BASE_SEPOLIA_RPC_PRIMARY`). Fix the root
  cause; do not loosen the guard.
- **Attestation row is `reputation_tx='FAILED'` post legacy-off
  flip** → `resolved.agentId` came through but the `giveFeedback` call
  itself reverted. Check Basescan for the revert reason; most likely
  cause is the SellingAgent's on-chain agentId being registered to a
  different clientAddress-scoped feedback policy than the facilitator
  is calling with. Do NOT manually retry; the row's `failure_detail`
  captures the revert for the (post-hackathon) retry-reconciler.
- **Gateway is serving stale `x402.splitter`** → this is an L4a₂
  cache issue, not an L4c bug. Trigger the cache-invalidate hook
  with the affected agentId, or wait out the TTL.

---

## References

- `specs/08a-l4c-factory-refactor.md` — spec (§4.2 settle-route flow,
  §5 env model, §6 migration, §7 tests, §8 deploy checklist).
- `contracts/src/SplitterFactory.sol` — factory v1.
- `contracts/test/SplitterFactory.t.sol` — 10-case forge suite.
- `workers/facilitator/src/treasury/splitter-resolver.ts` — per-payment
  resolver.
- `workers/facilitator/migrations/0003_l4c_splitter_factory.sql` — D1
  migration.
- `tools/integration-tests/full-flow-l4c-factory.sh` — smoke test
  driver (happy path + forged-splitter negative).
- `tools/deploy/deploy-l4b.md` — L4b₁ runbook (this runbook's parent
  pattern; reuse its Infisical + wrangler conventions).
