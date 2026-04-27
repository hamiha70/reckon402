# Reckon402 operator runbook

Index of operator-actionable workflows: provisioning, funding,
secret management, smoke tests, layer checkpoints. One entry
per discrete action, each pointing at the canonical recipe file
that owns the steps.

This file is the single grep target for "how do I do X?"
questions. It does not duplicate recipes — it points at them.
If a recipe doesn't yet have a home, this file holds the
inline copy until it earns its own .md under the appropriate
`tools/<area>/` directory.

## Quick reference

| Action | Recipe | Status |
|--------|--------|--------|
| Bootstrap a fresh workstation | [`README.md` → "Operator dependencies"](./README.md#operator-dependencies) | recipe |
| Provision software EOAs | [`tools/provisioning/README.md`](./tools/provisioning/README.md) | recipe |
| Push a sensitive secret to Infisical | [`tools/secrets/push-sensitive.md`](./tools/secrets/push-sensitive.md) | recipe |
| Push a non-sensitive secret to Infisical | inline below (§ Secrets) | inline |
| Hydrate secrets to drive a command | inline below (§ Secrets) | inline |
| Fund the deployer with Sepolia ETH | [`tools/funding/seed-deployer.md`](./tools/funding/seed-deployer.md) | recipe |
| Snapshot all reckon402 EOA balances | inline below (§ Funding) | inline |
| Set / update an ENS record on Sepolia | [`tools/ens/set-record.md`](./tools/ens/set-record.md) | recipe |
| Run all L0 smoke probes | inline below (§ Smoke tests) | inline |
| Run a single probe | inline below (§ Smoke tests) | inline |
| Verify the KMS signer end-to-end | inline below (§ KMS / signing) | inline |
| Cut a layer-checkpoint tag | inline below (§ Layer checkpoints) | inline |

## Bootstrap

One-time per workstation. The full ladder lives in
[`README.md`](./README.md) "Operator dependencies." TL;DR:

1. Node 22 LTS via the project `.nvmrc` + `pnpm install` at repo root.
2. AWS CLI: `~/.aws/credentials` profile `intentra` (admin) for
   provisioning, plus the scoped IAM users `reckon402-signer`
   and `reckon402-deployer` for routine signing.
3. Cloudflare CLI: `wrangler login` (OAuth) for daily work, OR
   `CLOUDFLARE_API_TOKEN` env for unattended use.
4. Infisical CLI: `infisical login --domain https://secrets.intentralabs.com`.
5. Foundry: `forge` and `cast` from the same install.
6. KeeperHub: `kh auth login` (device-code OAuth, OS keyring).

The L0 smoke suite (§ Smoke tests below) is the acceptance
gate that proves the workstation is ready. If `run-all.sh`
returns ALL PASS / SKIP, the workstation can drive any L0–L4
operator action.

## Secrets

### Push a sensitive secret (PK, API token, AWS access key)

See [`tools/secrets/push-sensitive.md`](./tools/secrets/push-sensitive.md).
Routes the value through a tmpfs-backed dotenv file and
`infisical secrets set --file` so the secret never crosses
argv, shell history, or persistent disk.

### Push a non-sensitive secret (RPC URL, address, account ID)

```bash
infisical secrets set \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  KEY=VALUE
```

Use this mode for: 8 RPC URL keys, public addresses, account
IDs, ENS names, the `_L0_SENTINEL` debug key. The argv leak
surface is unimportant for these — they're either public by
construction or disposable.

### Hydrate secrets to drive a command

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- bash -c 'cast call "$REGISTRY" "owner(bytes32)(address)" "$NODE" \
                --rpc-url "$ETH_SEPOLIA_RPC_PRIMARY"'
```

**The `bash -c '…'` wrap is load-bearing.** `infisical run --
cast call … "$NODE"` does not work because `$NODE` is expanded
by the outer shell *before* `infisical run` injects the env
into the child process. Single-quoted `bash -c '…'` defers
expansion until inside the child where the secrets actually
exist. Documented as a hard rule in
[`AGENTS.md`](./AGENTS.md) "Secrets and hydration."

## Funding

### Seed the deployer with Sepolia ETH

See [`tools/funding/seed-deployer.md`](./tools/funding/seed-deployer.md).
Runs two `cast send` invocations — one Base Sepolia, one
Ethereum Sepolia — from the x402commit funder
(`X402COMMIT_FUNDER_PK` in Infisical) to the reckon402 KMS
deployer EOA. Idempotency note: `cast send` is not idempotent;
check `funded.sh` first.

### Snapshot all reckon402 EOA balances

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- node tools/funding/check-balances.mjs
```

Reports ETH and USDC balances per EOA per chain. Use as a
before/after for any funding round; commit the output as
`tools/funding/results-<DATE>-<phase>.md` for traceability.

### Test-amount convention

Per [`AGENTS.md`](./AGENTS.md) hard rule: every x402-flow
test, recipe, and demo script uses **0.01 USDC** as the
canonical per-request price. At 20 USDC seeded per
reckon402-controlled EOA on Base Sepolia, this gives ~2000
round-trip iterations before any refill is needed.

### Refilling the funder

Out of repo scope. The `x402commit` facilitator funder
(`0x9AF7…3F04`) is operator-managed externally. When the
reckon402 build needs ETH, the operator adds to the funder
from a personal source and then runs `seed-deployer.md`
again to forward gas to the deployer.

## ENS records

### Set / update a record on Sepolia

See [`tools/ens/set-record.md`](./tools/ens/set-record.md).
Covers: registry resolver lookup, `setAddr` for the canonical
ETH `addr()`, `setText` for arbitrary text records, and a
note on NameWrapper detection. Round-1 actuals (the
`reckon402-test.eth` setup that closed Q-L0-1) are recorded
in the recipe under "Round 1 actuals."

The ENS test name + expected address are checked into
Infisical as `ENS_TEST_NAME` / `ENS_EXPECTED_ADDRESS`. The L0
`ens.sh` probe consumes them; no other probe depends on this
shape.

## Smoke tests

### Run all probes

```bash
infisical run \
  --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- ./tools/smoke-tests/run-all.sh
```

Acceptance gate: ALL PASS or SKIP. Per
[`AGENTS.md`](./AGENTS.md) hard rule "No 'expected-fail'
smoke probes," every probe must either pass or skip with a
locked disposition under `specs/00-l0-smoke-tests.md`
"Open questions."

Outcome lands in `tools/smoke-tests/results-<DATE>.md` for
the daily snapshot. Commit it as the verify step that closes
out a layer.

### Run a single probe

```bash
infisical run … -- ./tools/smoke-tests/<probe>.sh
```

Probe names: `infisical`, `cf`, `aws`, `rpc`, `ens`,
`erc8004`, `kh`, `d1`, `funded`. Each script exits 0 on
PASS, 2 on intentional SKIP, non-zero on FAIL. Useful when
investigating a specific regression without paying the
~25 s cost of the full suite.

## KMS / signing

### Verify the KMS signer round-trips for both keys

```bash
# deployer key (alias/reckon402/mainnet/deployer/evm)
infisical run … -- node tools/sign/verify-kms-account.mjs deployer

# buyer-signer key (alias/reckon402/mainnet/buyer-signer/evm)
infisical run … -- node tools/sign/verify-kms-account.mjs buyer-signer
```

Each invocation runs three sign+recover round-trips
(`signMessage`, `signTypedData`, `signTransaction`) against
the named KMS key and asserts that recovered addresses match
the KMS-derived address. Implementation contract:
[`specs/02-kms-signer.md`](./specs/02-kms-signer.md). Round-1
result log: [`tools/sign/results-2026-04-27.md`](./tools/sign/results-2026-04-27.md).

The verify script is the canonical L0+ acceptance gate for
KMS signing. Re-run after any IAM policy change, KMS key
rotation, or AWS region migration.

## Layer checkpoints

Per [`AGENTS.md`](./AGENTS.md) commit-cadence rules, layer
boundaries are marked with annotated git tags. Cut a tag at
the verify-step commit that closes the layer:

```bash
# Replace L0-green with the appropriate tag name. Allowed
# tags per AGENTS.md:
#   L0-green, L1-deployed, L2-paywall-via-cdp,
#   L3-our-facilitator-green, L4-kh-skill-green, H-9-submission
git tag -a L0-green -m 'L0 smoke suite: 8 PASS, 1 SKIP (Q-L0-2 deferred to L3)'
git push origin L0-green
```

The annotation message should reference the verify artifact
that justifies the tag — for L0-green, it's the
`tools/smoke-tests/results-2026-04-27.md` snapshot. ETHGlobal
judges read the commit graph + tags to verify in-event work,
so each tag annotation is part of the public submission
evidence trail.

## Maintaining this file

When a recipe is added or moved, update the Quick reference
table here in the same commit. When an inline section grows
beyond ~40 lines, graduate it to its own `.md` file under
`tools/<area>/` and replace the inline section with a pointer.

This runbook is an index, not a content store — recipes own
their steps, this file owns the catalogue.
