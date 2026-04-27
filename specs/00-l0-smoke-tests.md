# Spec 00 — L0 smoke tests

Status: implementation contract.
Owner: `tools/smoke-tests/`.

## Purpose

Verify that every external dependency the build relies on (CLIs, accounts,
networks, sponsor tooling) is reachable from this workstation **before any
contract or worker code is written**. If any probe is red, fix the infra gap
before writing more code (per `AGENTS.md` smoke-test-first principle).

## Hydration model

All runtime values that are not on the local filesystem hydrate from Infisical
project `reckon402` (env `dev`) at runtime. The recommended invocation pattern
is:

```bash
infisical run --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
  --env dev \
  --domain https://secrets.intentralabs.com \
  -- ./tools/smoke-tests/run-all.sh
```

Individual probes either:

- inherit env vars from the surrounding `infisical run` process; or
- call `infisical secrets get <KEY> --plain --silent` themselves for
  finer-grained reads.

`run-all.sh` MUST detect at startup that it is running under `infisical run`
(or that `INFISICAL_TOKEN` is otherwise present) and warn loudly otherwise.

## Probe inventory

8 probes total. Each is one bash script under `tools/smoke-tests/`. Probe
order in `run-all.sh` is the order listed below — Infisical first because
every subsequent probe depends on hydrated secrets.

| # | Script | Purpose | Hard requirement | PASS / SKIP / FAIL |
|---|--------|---------|------------------|--------------------|
| 1 | `infisical.sh` | Hydration layer reachability + valid CLI session + round-trip read | yes | PASS / FAIL |
| 2 | `cf.sh` | Cloudflare auth + DNS resolution for root + Wrangler dry-run | yes | PASS / FAIL |
| 3 | `aws.sh` | AWS STS + KMS alias presence + sign-and-recover round-trip | yes | PASS / FAIL |
| 4 | `rpc.sh` | `eth_chainId` against 4 endpoints (Base mainnet/Sepolia × primary/fallback) | yes | PASS / FAIL |
| 5 | `ens.sh` | CCIP-Read end-to-end against a Sepolia stub | yes | PASS / FAIL |
| 6 | `erc8004.sh` | `getAttestationCount` read on Base mainnet | yes | PASS / FAIL |
| 7 | `kh.sh` | KeeperHub stub-agent webhook callback | optional | PASS / SKIP / FAIL |
| 8 | `d1.sh` | `wrangler d1 create` + INSERT/SELECT cycle | yes | PASS / FAIL |

Each script:

- Sets `set -euo pipefail` at the top.
- Exits 0 on PASS, 2 on SKIP (intentional), non-zero on FAIL.
- Echoes a single-line `PASS|SKIP|FAIL <probe> <duration_ms> [note]` summary
  to stdout.
- Writes diagnostic detail to stderr only on FAIL.

`run-all.sh` accumulates results into a Markdown table and exits 0 only if
no probe FAILs (SKIPs are non-fatal).

## Probe specifications

### 1. `infisical.sh`

**Purpose.** Verify the hydration layer is up and we can round-trip a
sentinel secret. Every other probe assumes this works.

**Steps.**
1. `curl -fsS https://secrets.intentralabs.com/api/status` → expect HTTP 200,
   JSON body containing `"date"` field (Infisical's status response shape).
2. `infisical user get token --plain --silent` → expect non-empty.
3. Write a transient sentinel value to `reckon402/dev` under key
   `_L0_SENTINEL` (value = `"l0-${EPOCHSECONDS}"`); read it back via
   `infisical secrets get`; assert equality; delete the key.
4. Total wall time captured; reported in summary line.

**Pass.** All four steps succeed within 10 s combined.

### 2. `cf.sh`

**Purpose.** Cloudflare CLI auth + root-zone DNS reachability + dry-run
deploy works.

**Steps.**
1. `wrangler whoami` → expect "You are logged in" or equivalent (parse for
   account ID). Either an OAuth session OR a scoped API token is acceptable
   at L0; scoped-token migration is tracked under Q-L0-3.
2. `dig +short NS reckon402.com @1.1.1.1` → expect Cloudflare nameservers
   (proves the zone is on Cloudflare and we can deploy DNS records into it).
   Apex A record is OPTIONAL at L0 — Pages/Workers Routes provision it
   during L1.
3. `dig +short A {agent,facilitator,gateway,signing,demo}.reckon402.com @1.1.1.1`
   → record per subdomain, treated as a soft warning, not a failure
   (subdomain DNS is L1 work).
4. `wrangler deploy --dry-run` against a placeholder `wrangler.toml` shipped
   under `tools/smoke-tests/cf-placeholder/`. Expect "Total Upload" output
   without errors.

**Pass.** Steps 1, 2, 4 PASS. Step 3 produces a per-subdomain report;
soft warnings logged but do not fail the probe.

### 3. `aws.sh`

**Purpose.** AWS CLI auth + KMS key presence + EOA control proof.

**Steps.**
1. `aws sts get-caller-identity` → expect JSON output. Capture `Account`,
   `Arn`, `UserId`. Soft assertion: `Arn` should reference IAM user
   `reckon402-signer`, but any successful identity is accepted (operator
   may have a different active profile during early provisioning).
2. `aws kms get-public-key --region eu-central-1 --key-id alias/reckon402/mainnet/buyer-signer/evm`
   → expect a JSON response with `KeySpec=ECC_SECG_P256K1`. This validates
   alias presence using only `kms:GetPublicKey` (already in the scoped
   policy); deliberately avoiding `kms:ListAliases` keeps the IAM
   policy at minimum scope.
3. Run `tools/smoke-tests/kms-verify.mjs`:
   - Fetch KMS public key via `aws kms get-public-key`.
   - Parse DER `SubjectPublicKeyInfo`, extract uncompressed secp256k1 point.
   - Compute `derivedAddress` = last 20 bytes of `keccak256(pubKey[1:])`.
   - Hash a fixed 32-byte digest (`keccak256("reckon402 L0 ownership proof
     2026-04-27")`).
   - `aws kms sign` with `MessageType=DIGEST`, `SigningAlgorithm=ECDSA_SHA_256`.
   - Parse DER signature → `(r, s)`; normalize low-S; recover with `v=27`
     and `v=28`; assert one of the recoveries equals `derivedAddress`.

**Pass.** Steps 1, 2, 3 all succeed.

### 4. `rpc.sh`

**Purpose.** Two-RPC redundancy across Base mainnet and Base Sepolia.

**Steps.** For each of `BASE_MAINNET_RPC_PRIMARY`, `BASE_MAINNET_RPC_FALLBACK`,
`BASE_SEPOLIA_RPC_PRIMARY`, `BASE_SEPOLIA_RPC_FALLBACK`:

1. Hydrate URL from Infisical via `infisical secrets get <KEY> --plain --silent`.
   FAIL if any of the four keys is empty.
2. POST `{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}` with
   5-second timeout.
3. Assert response `.result` matches the expected chain ID hex:
   - `0x2105` (8453) for Base mainnet endpoints
   - `0x14a34` (84532) for Base Sepolia endpoints
4. Capture per-endpoint latency in ms.

**Pass.** All four endpoints return correct chain ID. PRIMARY endpoints
must each be < 200 ms p50; FALLBACK endpoints have no latency requirement
(acceptable to be slower; they exist for redundancy, not hot path).

**FAIL note.** If any endpoint is unreachable, treat as FAIL — even though
the fallback exists, an early-detected outage on either pair member is a
signal that the redundancy is not currently two-deep.

### 5. `ens.sh`

**Purpose.** CCIP-Read wildcard resolution end-to-end through `ezccip.js`
against a Sepolia stub. **Highest-risk probe** — most likely to surface a
tooling-version mismatch.

**Steps.**
1. Resolve `reckon402-test.eth` (or a configured equivalent) via a viem
   `getEnsAddress` call against Sepolia, with the resolver pointing at a
   wildcard-resolver contract that supports CCIP-Read.
2. Validate that `msg.sender` recovery from the wildcard `callData` returns
   the expected resolver contract address (Pattern A msg.sender recovery).
3. Compare the resolved address against the configured expected value.

**Pass.** Resolution returns the expected address and the Pattern A
recovery matches.

**FAIL — common remediation paths.**
- `ezccip.js` version mismatch with viem CCIP-Read API → pin viem and
  ezccip versions in `tools/smoke-tests/package.json`.
- DNS `_dnstest._tcp.reckon402-test.eth` (or equivalent) record missing →
  document required record shape in the spec text and add it via the ENS
  resolver UI for the test name.
- Resolver contract not deployed on Sepolia → spec a minimal stub resolver
  in `tools/smoke-tests/ens-stub/` and deploy via `forge script`.

The exact ENS test name and resolver contract address are tracked under
"Open Questions" below — must be locked before commit-2 of the L0 batch.

### 6. `erc8004.sh`

**Purpose.** Validate ABI subset + Base mainnet RPC pool reaches contracts.

**Steps.**
1. Hydrate `BASE_MAINNET_RPC_PRIMARY` from Infisical.
2. Call `getAttestationCount(<known mainnet agent address>)` against the
   ERC-8004 reputation registry contract on Base mainnet using viem.
3. Accept any non-error response. Count = 0 is fine; the read path proves
   out the ABI + RPC reachability + chain ID alignment.

**Pass.** Call succeeds without revert. Count value is logged for
informational purposes.

**Open question.** ERC-8004 registry contract address on Base mainnet
must be locked before commit-2. Tracked below.

### 7. `kh.sh`

**Purpose.** KeeperHub registration + webhook callback round-trip.

**Steps.**
1. Check `KEEPERHUB_API_KEY` hydrated. If empty, exit 2 (SKIP) with a
   message: "KH not yet provisioned; provision before L4."
2. Otherwise: register a stub agent via the documented KH API endpoint
   (consult KH docs at runtime — endpoint URL not hard-coded in spec).
3. Trigger the agent and confirm a webhook callback arrives at a
   `wrangler tail`-watched temporary worker that this script creates and
   tears down inline.

**Pass.** Stub agent registered, callback received within 30 s, temp
worker torn down cleanly.
**Skip.** `KEEPERHUB_API_KEY` empty.
**Fail.** Any other error path.

### 8. `d1.sh`

**Purpose.** Cloudflare D1 reachability + write/read round-trip + latency.

**Steps.**
1. `wrangler d1 create reckon402-d1-smoke-test` (idempotent — accept "already
   exists" as success).
2. `wrangler d1 execute reckon402-d1-smoke-test --command "CREATE TABLE IF
   NOT EXISTS l0 (k TEXT PRIMARY KEY, v TEXT, ts INTEGER)"`.
3. INSERT one row with sentinel `(k='_l0', v='${EPOCHSECONDS}', ts=...)`.
4. SELECT the row back; assert equality.
5. Capture wall time across steps 3 + 4.

**Pass.** Round-trip succeeds, total INSERT+SELECT latency < 5000 ms.
The 5 s gate accommodates remote-D1 RTT to a Cloudflare data center;
local D1 (`wrangler dev`) would land in the tens of ms but is not the
deployment target for any reckon402 worker. A latency above 5 s is a
genuine network or D1-region problem worth investigating.

## Provisioning prerequisites

Probes 1, 2, 3, 4, 8 require the following to be in place before the run:

| Item | Provisioning command | Status at spec time |
|------|---------------------|---------------------|
| Infisical project `reckon402` | `~/Projects/aws_setup_2026/scripts/infisical-project.sh create reckon402 --slug reckon402` | DONE |
| Infisical dev secrets: 4 RPC URLs | `infisical secrets set --file=…` (via tmpfs scratch) | DONE |
| Infisical dev secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | same pattern | TODO before run |
| KMS key `alias/reckon402/mainnet/buyer-signer/evm` (`eu-central-1`) | `aws kms create-key …` + `aws kms create-alias …` | TODO before run |
| IAM user `reckon402-signer` + scoped KMS policy | `aws iam create-user …` + `aws iam create-policy …` + `aws iam attach-user-policy …` | TODO before run |
| Access keys for `reckon402-signer` → Infisical (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) | `aws iam create-access-key` + `infisical-secret-put.sh` | TODO before run |
| Cross-repo append: KMS entry to `~/Projects/aws_setup_2026/docs/x402commit-kms.md` | manual edit + commit in that repo | TODO post-provision |

## Open questions

- **Q-L0-1.** ENS test name. Build cadence cites `reckon402-test.eth`; need
  to confirm registration + resolver wiring before `ens.sh` can pass.
  Disposition: blocking ens.sh commit-2.
- **Q-L0-2.** ERC-8004 registry contract address on Base mainnet.
  Disposition: blocking erc8004.sh commit-2; should be sourceable from the
  ERC-8004 reference deployments doc.
- **Q-L0-3.** Cloudflare scoped API token vs. existing global wrangler
  session. CLI-first preference applies, but token *creation* requires
  either a parent token with `User > API Tokens > Edit` scope or the
  Cloudflare dashboard. If neither is available, L0 uses the existing
  global session and the scoped token is provisioned by the operator
  before L1.
  **Disposition: partially resolved 2026-04-27.** Operator created a
  scoped token via dashboard; pushed to Infisical as
  `CLOUDFLARE_API_TOKEN` along with `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_ZONE_ID` (`reckon402.com` → `381e8c2d529e24332ee646a8f8695019`),
  and `CLOUDFLARE_ZONE_NAME`. Probe verification showed the token
  carries **only zone-level scopes** for `reckon402.com` (DNS: Edit,
  Workers Routes: Edit) and is missing the **account-level** scopes
  required for L1 deploys (`Workers Scripts: Edit`, `D1: Edit`,
  optionally `Workers Tail: Read`). Re-issuance with the full
  permission set is a blocker for L1 deploy automation; `wrangler`
  OAuth session remains usable as a fallback. Tracked as a follow-up:
  the next token push to Infisical with the same key name overwrites
  cleanly.
- **Q-L0-4.** KH API access. Per build cadence, provisioning during L0 is
  acceptable; if KH is not provisioned by the time `run-all.sh` runs, the
  probe SKIPs cleanly.
  Disposition: deferred — non-fatal SKIP path documented.
