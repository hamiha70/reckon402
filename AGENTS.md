# Reckon402 — Implementation Repo Agent Instructions

## What this repo is

Public OSS submission to ETHGlobal OpenAgents 2026 (deadline Sat 2026-05-03
18:00 CET). A closed-loop x402 reputation engine: settlement-side ERC-8004
attestation writes wired into ENS-resolved x402 routing, paired with
adoption surfaces (buyer SDK, middleware, KH skill, signing wrapper).

**Tagline:** Agent commerce with memory.

## Commit cadence (load-bearing)

ETHGlobal judges read the commit graph to verify fresh, in-event work.
The cadence rules:

- **Specs land in their own commits** BEFORE the code that implements them.
- **Each implementation step is three commits:** spec commit → code
  commit → test/verify commit (or deploy log).
- **Granular commits, ~30–50 over the build window.** No giant rollups.
- **Annotated git tags at clean checkpoints:** `L0-green`, `L1-deployed`,
  `L2-paywall-via-cdp`, `L3-our-facilitator-green`, `L4-kh-skill-green`,
  `H-9-submission`.

The pattern that reads as authentic engineering:

```
spec → implement → verify → next spec
```

The pattern that reads as preserved/recycled work and undermines judging:

```
one giant initial commit dropping all specs + half-built code
```

## Layered build (L0–L4, locked)

The build is sequenced as five additive layers. At any drop-flag moment
after H-6, at least one layer deeper than L2 is recordable end-to-end
without depending on layers that haven't shipped yet.

| Layer  | What ships                                                             | Goal                                                                                                           |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **L0** | Infra + sponsor-tech smoke tests (CF, AWS, RPC, ENS, ERC-8004, KH, D1) | Every CLI, every account, every dependency reachable. Zero contract code.                                      |
| **L1** | `agent.reckon402.com` Cloudflare Worker, returns canned response, free | Hello-world Worker + custom-domain DNS + Wrangler tail observability working.                                  |
| **L2** | Same Worker + canonical x402 v2 paywall via Coinbase facilitator (CDP) | Validates we ship a superset of canonical x402, not a fork. Catches wire-format bugs on a known-good baseline. |
| **L3** | Splitter on Base Sepolia + our Facilitator + buyer SDK                 | Replace CDP facilitator with ours. Claude Code SDK drives full flow → on-chain settlement.                     |
| **L4** | Signing wrapper Lambda + KH workflow + KH skill                        | Same flow but driven from KeeperHub instead of Claude Code.                                                    |

**Smoke-test-first principle.** If any infra probe is red at L0, stop
and fix before writing more code. This applies at L0 and at every
subsequent layer start. Sponsor tooling and compatibility gaps are the
biggest hidden-time-cost in hackathon work; verifying early is much
cheaper than debugging mid-build.

## Hard rules

- **Public OSS, fresh code only.** No copy-paste from any external repo.
  When a spec describes a contract or component shape, the
  implementation is written from scratch in this session.
- **No proprietary terminology in commits, code, or docs.** No "RCO",
  no internal-only headers, no internal domain references. Public
  surface must be self-standing.
- **No marketing language in specs.** Specs are technical contracts.
  Persuasive copy belongs in `README.md` and `demo/` only.
- **No emojis** unless the user explicitly requests them.
- **Wire-compat with canonical x402 v2.** Reckon402 extensions are an
  ADDITIVE SUPERSET of canonical x402 — never replace canonical fields,
  only extend. The canonical `requestId` (UUID v4 per attempt) stays;
  Reckon402 adds a deterministic `paymentId` BELOW it.
- **`version: 2` only.** Reject `version: 1` in the X-Payment header.
- **Solidity 0.8.24 + OpenZeppelin 5.3.0** for contracts. Foundry +
  Forge for tests. Vitest for TypeScript tests.
- **CLI-first for AWS and Cloudflare.** Provisioning, smoke tests, and
  reads MUST be driven via `aws` CLI and `wrangler` / Cloudflare REST
  API rather than the AWS Console or Cloudflare dashboard. If a step
  cannot be done from CLI (e.g., creating a fresh scoped API token
  without a parent token), flag it explicitly and the human operator
  takes over for that one step.
- **Test amounts: 0.01 USDC per service request.** All x402-flow
  tests, recipes, and demo scripts use **0.01 USDC** as the canonical
  per-request price unit unless a specific test narrates otherwise.
  At 20 USDC seeded per reckon402-controlled EOA on Base Sepolia
  that's ~2 000 round-trip iterations before refill. Mainnet flows
  during L4 demo follow the same 0.01-USDC convention. Principle:
  small enough to iterate without faucet/funder churn, large enough
  to be a real on-chain value transfer (not a 1-wei stub the EVM
  treats as a no-op fee path).
- **Sepolia gas funding: 1 ETH seed, 0.01 ETH floor.** The KMS
  deployer EOA is seeded with **1 ETH** on each of Base Sepolia
  and Ethereum Sepolia from the x402commit-funder
  (`X402COMMIT_FUNDER_PK` in Infisical). The L0 `funded.sh` probe
  enforces a **0.01 ETH per-chain floor** on the deployer at every
  layer transition. Refill is operator-managed: when `funded.sh`
  goes red, re-run `tools/funding/seed-deployer.md`. Deployer is
  the single source of funds for every other reckon402-controlled
  EOA — no address gets funded directly from the operator's main
  wallet except the deployer.
- **Top-up rounds: 0.1 ETH per round, deployer→other-EOA path.**
  Top-ups *after* the initial 1-ETH seed should target **0.1 ETH per
  round**, not 1 ETH. The Base Sepolia public faucet daily ceiling
  is ~1 ETH/day per recipient — a single 1-ETH top-up burns a full
  day's faucet quota and leaves no headroom if the funder itself
  runs dry. Realized state (round 2, 2026-04-28): facilitator EOA
  `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` funded with 1 ETH
  from `X402COMMIT_FUNDER_PK` (tx
  `0xb78cccd849e5feef4df9e83895b3715e987c27bcfc835bccd481bd8162c37e84`)
  ahead of L3 deploy. Two deviations from the rule above acknowledged:
  (a) round size was 1 ETH not 0.1 ETH (oversight, faucet quota
  burned for the day); (b) funded directly from the funder rather
  than from the deployer (pragmatic — no KMS-signed value-transfer
  tool yet for deployer → other-EOA top-ups). Round 3+ should
  converge to (a) 0.1 ETH amounts and (b) deployer-as-source once
  the KMS value-transfer tool exists. Open question / future work:
  automated refund (e.g., a Cloudflare cron probe that triggers a
  signing-wrapper-issued top-up when a watched EOA crosses the 0.01
  ETH floor). Until then, the operator runs `tools/funding/seed-*.md`
  recipes manually when `funded.sh` goes red.
- **TypeScript-first for all production surfaces.** Every file under
  `workers/`, `packages/`, `lambda/`, and `demo/` MUST be `.ts` /
  `.tsx`. Plain `.js` / `.mjs` is only acceptable in `tools/` for
  one-shot CLI scripts that are never imported by production code.
  When a `tools/` module graduates to being consumed by a production
  package (e.g. `kms-account.mjs` → `packages/buyer-sdk`), rewrite
  it in TypeScript at that point. The smoke-test `worker.js`
  placeholder is deleted when the real `workers/agent/` tree lands.
  `tsconfig.base.json` is the shared strict baseline; each sub-package
  extends it via `"extends": "../../tsconfig.base.json"`.
- **No "expected-fail" smoke probes.** Every L0–L4 health check must
  terminate PASS or SKIP, where SKIP carries a disposition pointer
  to the open question that gates it (e.g. `ens.sh` SKIP keyed to
  Q-L0-1, `erc8004.sh` SKIP keyed to Q-L0-2). FAIL rationalised as a
  "known quirk" is never an accepted disposition: fix the probe,
  narrow its scope to the part that is actually green, or remove
  the probe entirely. Hard probes (`infisical`, `cf`, `aws`, `rpc`,
  `kh`, `d1`, `funded`) must stay green at every layer transition;
  do not document quirks that the suite is silently tolerating.

## Secrets and hydration (v1)

All developer-workstation env vars (RPC URLs, Cloudflare API tokens,
AWS access keys for `reckon402-signer`, KeeperHub keys) live in the
**self-hosted Infisical** project `reckon402` at
`https://secrets.intentralabs.com`. Local commands run under
`infisical run --env dev -- …` to inject secrets at runtime.
`.envrc` (gitignored) only carries the Infisical hydration parameters
(domain, project ID, optional Universal-Auth client id/secret); no
plaintext secret values land in repo files.

KMS-resident signing material (the `reckon402-signer` private key) is
non-retrievable by design and stays in AWS KMS in `eu-central-1`.
Infisical and KMS are orthogonal; see
`~/Projects/aws_setup_2026/docs/{infisical-host.md,x402commit-kms.md}`
for the operator-side documentation.

AWS profile split on the operator workstation: admin operations
(creating KMS keys, IAM users, IAM policies) run under
`AWS_PROFILE=intentra` (which maps to IAM user `intentra-admin`).
Runtime workloads (smoke tests, Lambda, signing wrapper) use the
narrowly-scoped `reckon402-deployer` / `reckon402-signer` access keys
hydrated from Infisical. When invoking workloads via
`infisical run --env dev -- …`, `unset AWS_PROFILE` (or use
`env -u AWS_PROFILE …`) so the Infisical-injected
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` win in the AWS SDK
credential-resolution chain.

**Shell-expansion under `infisical run`.** Variables hydrated by
Infisical (`BASE_SEPOLIA_RPC_PRIMARY`, `ETH_SEPOLIA_RPC_PRIMARY`,
`DEPLOYER_EOA`, etc.) only exist inside the child process that
`infisical run --env dev -- …` spawns, not in the outer shell that
invokes the wrapper. Multi-arg commands that reference those
variables MUST be wrapped as `infisical run … -- bash -c '…'` with
**single quotes** so the `$VAR` references stay literal until the
Infisical-injected child starts. The naïve form
`infisical run … -- cast send --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" "$DEPLOYER_EOA"`
expands `$BASE_SEPOLIA_RPC_PRIMARY` and `$DEPLOYER_EOA` in the
outer shell to empty strings before `infisical run` is reached,
producing silent arg-truncation bugs (typically: `cast` rejecting
an empty `--rpc-url` or empty TO address). Variables that are
already exported in the outer shell (e.g. an ad-hoc
`X402COMMIT_FUNDER_PK`) pass through correctly because
`infisical run` inherits the outer environment in addition to
injecting Infisical secrets on top.

## Locks (non-negotiable)

| Item                       | Value                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ |
| Public domain              | `reckon402.com`                                                                |
| Demo merchant agent        | `agent.reckon402.com` (CFW + Hono)                                             |
| Facilitator                | `facilitator.reckon402.com` (CFW + Hono + D1)                                  |
| CCIP-Read gateway          | `gateway.reckon402.com` (CFW + Hono + D1)                                      |
| Signing wrapper            | `signing.reckon402.com` (CNAME → AWS API Gateway)                              |
| Demo frontend              | `demo.reckon402.com` (Vercel)                                                  |
| Landing page + docs        | `reckon402.com` (Cloudflare Pages)                                             |
| AWS region                 | `eu-central-1`                                                                 |
| AWS account                | `975170806362` (operator-shared account; also hosts `intentra-admin`)          |
| KMS alias — deployer       | `alias/reckon402/mainnet/deployer/evm` (IAM user `reckon402-deployer`)         |
| KMS alias — buyer-signer   | `alias/reckon402/mainnet/buyer-signer/evm` (IAM user `reckon402-signer`)       |
| Cloudflare account ID      | `0f38f8667bbcbe4f54eda13c8df009e0`                                             |
| Cloudflare resource prefix | `reckon402-*` (e.g., `reckon402-facilitator-prod`, `reckon402-d1-facilitator`) |
| Primary RPC provider       | Alchemy app `reckon402` (Base mainnet + Base Sepolia); public Base RPC fallback |
| Settlement chain (demo)    | Base Sepolia for L3 dev; Base mainnet for L4 / submission                      |

## On-chain EOAs (v1, locked)

Seven EOAs total, **same address on Base Sepolia and Base mainnet**.
Custody design and funding plan: `specs/01-eoa-topology.md`.
Provisioning log + addresses: `tools/provisioning/results-2026-04-27.md`.

| Role            | Address                                      | Custody  |
|-----------------|----------------------------------------------|----------|
| Deployer        | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | KMS      |
| Buyer-signer    | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` | KMS      |
| Facilitator     | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | software |
| Seller          | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | software |
| Buyer-demo-1    | `0x837e30740a4A5bAC5480b4f707924469d42b43De` | software |
| Buyer-demo-2    | `0xa5B79dCC1ec00730dcE031B803AF9A563B50A186` | software |
| Buyer-demo-3    | `0x3529C5fe5Dcb1C1E0Bc8a393dF75EB88CF23E1e1` | software |

Single source of funds: the deployer is the **first-funder** of every
other EOA. No address is funded directly from the operator's main
wallet except the deployer.

**External agent identities** (not in the reckon402-controlled set):

| Identity | Address | Custody |
|----------|---------|---------|
| KeeperHub workflow wallet | `0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4` | Turnkey TEE (non-custodial; KH-managed) |

KH wallet role is documented in `specs/01-eoa-topology.md` "External
agent identities" + Q-01-5. Default L4 plan: KH workflow hits the
signing wrapper Lambda which signs via KMS buyer-signer; the KH
wallet itself only authenticates the workflow and does not sign
x402 PaymentAuthorizations.

## KMS resources (v1, locked)

The two KMS-custodied EOAs are backed by project-scoped secp256k1 keys
(`ECC_SECG_P256K1`, usage `SIGN_VERIFY`) in `eu-central-1` /
account `975170806362`. Cross-repo source of truth:
`~/Projects/aws_setup_2026/docs/x402commit-kms.md`.

| Role          | Alias                                       | Key ID                                 | IAM user             | Controls EOA                                  |
|---------------|---------------------------------------------|----------------------------------------|----------------------|-----------------------------------------------|
| Deployer      | `alias/reckon402/mainnet/deployer/evm`      | `5b6e7c40-49e8-42cf-80a3-c22d52d3f40a` | `reckon402-deployer` | `0x66c2858d9a8605957c516a77262eb66ee6be113c`  |
| Buyer-signer  | `alias/reckon402/mainnet/buyer-signer/evm`  | `5a0350e0-d502-4579-8d45-d31c843a5f3f` | `reckon402-signer`   | `0x46bbb05aca9ea24118b8a57c8d3f317503384305`  |

Each IAM user carries a scoped policy granting only `kms:Sign` +
`kms:GetPublicKey` on its single key ARN — no wildcard KMS access.

## Persistence model (v1)

Single-tier **D1-only** for all worker state. Per-paymentId idempotency
guaranteed by SQLite UNIQUE constraint + `INSERT OR IGNORE`. Forward-
compat path to multi-tier (KV + DO-SQLite + relational) after hackathon.

## Infisical project locks

| Item | Value |
| ---- | ----- |
| Self-hosted host | `https://secrets.intentralabs.com` |
| Project slug | `reckon402` |
| Project ID | `84d8a29b-27e3-46d0-bf72-bbe01215ac35` |
| Default env for dev | `dev` |
| Wrapper for project CRUD | `~/Projects/aws_setup_2026/scripts/infisical-project.sh` |
| Wrapper for sensitive single-secret push | `~/Projects/aws_setup_2026/scripts/infisical-secret-put.sh` |

## npm publishing (v1, locked)

| Item | Value |
| ---- | ----- |
| Public scope | `@reckon402` |
| npm org | `reckon402` (admin: `hansmichael`) |
| Co-existing org | `intentralabs` (kept active for non-Reckon402 OSS — does NOT host any `@reckon402/*` packages) |
| Default access | `public` |
| Token storage | Infisical `reckon402/dev` → `NPM_AUTOMATION_TOKEN` (granular, scoped to `@reckon402/*`, expires 2026-07-26) |
| Token rotation | Revoke + re-issue on or before expiry; re-store via `infisical-secret-put.sh` (`KEY=@/path/to/file` form). Update this row's expiry date in the same commit. |
| Publish invocation | `infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '...'` (single-quoted body so `$NPM_AUTOMATION_TOKEN` resolves in the Infisical-injected child, not the outer shell) |

Workspace package targets:

- `@reckon402/types` — canonical x402 v2 wire-format types (extracted at L2, default `workspace:*` consumption only)
- `@reckon402/facilitator-client` — Reckon402 facilitator HTTP client (L3)
- `@reckon402/middleware-hono` — Hono middleware factory (L3)
- `@reckon402/buyer-sdk` — buyer-side helpers (L3)
- `@reckon402/kh-skill` — KeeperHub skill bundle (L4)

**Default policy: no registry publish during L2–L4 build commits.**
Workspace consumption via `workspace:*` is sufficient for the
hackathon path. Optional `0.x.0` publishes are an H-9 polish step
gated on remaining time budget. Token rotation and any actual
registry publish run under the standard invocation above; the
plaintext token never lands in `~/.npmrc` between commands
(`npm config set` immediately followed by `npm config delete`).

## Repo layout

```
reckon402/
├── specs/         # implementation contracts (one .md per layer/component)
├── packages/      # pnpm workspaces (@reckon402/types, /buyer-sdk, /middleware-hono, /kh-skill)
├── workers/       # CFW deployment units (agent, facilitator, gateway, treasury-deposit)
├── lambda/        # AWS Lambda (signing wrapper)
├── contracts/     # Foundry project (Splitter)
├── recipes/       # reproducibility scripts (curl, viem, python, keeperhub.json)
├── demo/          # Vercel frontend
└── tools/         # build/deploy/smoke-test scripts
```

## Operator runbook

`RUNBOOK.md` at repo root is the single index for operator
workflows: provisioning, secrets, funding, ENS, smoke tests,
KMS signing, layer checkpoints. Each entry points at the
canonical recipe under `tools/<area>/<recipe>.md`; the runbook
itself does not duplicate recipe content. When asked "how do I
do X?", grep `RUNBOOK.md` first.

Inline sections in `RUNBOOK.md` graduate to their own `.md`
file under `tools/<area>/` once they exceed ~40 lines. When a
recipe is added, moved, or graduated, update the
`RUNBOOK.md` Quick reference table in the same commit.

## MCP servers (agent tooling)

Implementation agents in this repo have these MCP servers available
locally (per `~/.claude.json`). Use them deliberately — default to
repo files first; reach for an MCP only when a specific external
lookup is needed.

| Server | Use when |
| ------ | -------- |
| `alchemy` | Base/Ethereum Sepolia RPC queries (preferred over public RPC for integration tests and balance probes); mainnet RPC at H-1 cutover. |
| `aws` | AWS docs / IaC / pricing for Lambda + KMS work (mainly L4b Signing Wrapper, occasional KMS quirks). |
| `cloudflare` | Workers / D1 / Pages / wrangler docs + observability (L4a Gateway, L4c Demo, any wrangler/d1 issue). |
| `context7` | Library/SDK docs (viem, hono, ezccip, vitest, miniflare, foundry, just). First stop for "how does X library do Y" — cheaper and more current than web search. |
| `puppeteer` | Browser automation for L4c demo-flow verification (click-through, render checks). Not needed for backend work. |

**Per-prompt MCP allowlist.** Each layer's prompt explicitly names
which MCPs are in-scope for that session. MCPs off the allowlist are
off-limits — do not speculatively call out-of-scope servers "to be
helpful." This keeps sessions deterministic and reviewable.

**Never paste secrets through MCPs.** Private keys, API tokens, KMS
material, and Infisical-injected values never transit any MCP. Public
RPC response data is fine; sensitive request bodies are not.

**`context7` over web search for library questions.** Curated docs
beat hallucination-prone blog posts and stale Stack Overflow answers.

**`cloudflare` MCP is read-only for docs.** Production `wrangler`
deploys still run from the local CLI under `infisical run`; the MCP
is for understanding, not execution.

## Spec workflow

Specs are produced by adapting external design docs supplied by the user
in each prompt. Adaptation rule:

- Trim to 30–50% of source-doc length.
- Drop strategic positioning, decision-history blockquotes, H-N timing
  annotations, `[VERIFY]` markers (relabel as "Open Questions"), and
  cross-references to docs not in this repo.
- Keep technical contracts, ABI fragments, TS types, schemas, state
  machines, test plans, and forward-compat hooks.

Specs are committed under `specs/`, it is the canonical implementation
contract.

## L3 deployments (v1, locked)

| Item | Value |
| ---- | ----- |
| Splitter (Base Sepolia) | `0x0ad507c6973eba86313794329ad9b12fbf24acd0` |
| Splitter deploy tx | `0xaa3cb87703c8320a7ece5b2d267d9101fd89199cf9c066fec9fde765b77af443` |
| Deploy signer | `0x66C2858D9A8605957c516a77262Eb66EE6be113C` (KMS `alias/reckon402/mainnet/deployer/evm`) |
| D1 database name | `reckon402-d1-facilitator-dev` |
| D1 database ID | `ad5bd36d-1903-4340-bc27-1f46b878b2c0` |
| Facilitator worker URL | `https://facilitator.reckon402.com` |
| Agent worker URL | `https://agent.reckon402.com` |

Full-flow + replay green on 2026-04-28. Evidence:
`tools/integration-tests/results-full-flow-l3-2026-04-28T07-01-42Z.md` +
`tools/integration-tests/results-replay-l3-2026-04-28T07-01-51Z.md` +
`tools/integration-tests/wrangler-tail-2026-04-28T07-01-37Z.log`.

## Operator ergonomics

`just` is the primary developer entrypoint for this repo. It wraps
leaf operator commands only — not the full multi-step deploy
orchestration (that gating is the audit trail; see below).

### Rationale and locks (final)

Decided at the L3-green → L4-start boundary (2026-04-28). Locked in
`reckon402_handoff_prompts.md` § I.8 "Deferred to L3-green → L4-start
boundary (operator ergonomics)" and confirmed overturning the prior
pnpm-first lock. Do not re-litigate.

### Rules

- **`just` at the repo root, not `make`, not `turbo`, not pnpm as
  orchestrator.** pnpm remains the JS/TS task runner via per-package
  scripts; `just` calls `pnpm --filter @reckon402/<pkg> <task>`
  directly. `make` is hard-banned; `turbo` is deferred (no
  build-graph caching problem at hackathon scale).
- **Runbooks are canonical; recipes are sugar.** `tools/deploy/*.md`
  and `tools/funding/*.md` are the authoritative operator surface and
  audit trail. Recipes wrap the leaf commands; they do NOT replace or
  drift away from the runbooks. When a runbook changes, update the
  recipe to match — not the reverse.
- **Do NOT wrap the deploy orchestration.** No `just deploy-l3`.
  The 10-step gating + manual operator sign-off + per-step output
  capture IS the audit trail. Wrap leaf commands only.
- **Infisical only; no `.env` files.** `set dotenv-load := false` in
  the justfile. Non-secret defaults (RPC URLs, chainIds, contract
  addresses) live inside the justfile as recipe-local variables. No
  `.env` allowance — it creates a dual source of truth and the
  "non-sensitive" line drifts over time.
- **All Infisical invocations go through `tools/with-secrets.sh`.**
  Single source of the `infisical run --env dev --domain https://secrets.intentralabs.com`
  invocation. Recipes call `{{secrets}} <command>`; no hard-coded
  `infisical run ...` anywhere else.
- **Multi-step recipe bodies go in `tools/scripts/<name>.sh`**, not
  chained `bash -c` inline. Scripts use `#!/usr/bin/env bash` +
  `set -euo pipefail` + positional parameter validation.
- **Per-package pnpm scripts stay as-is.** Do NOT consolidate or
  rewrite existing per-package `test`/`build`/`lint` scripts.

### Tier-1 recipes (most-used)

```bash
just preflight-l3           # L3 deploy pre-flight (KMS + balance + RPC probes)
just balance                # ETH + USDC snapshot for all reckon402 EOAs
just tail-facilitator       # wrangler tail reckon402-facilitator-prod
just tail-agent             # wrangler tail reckon402-agent-prod
just fullflow-l3            # live end-to-end L3 integration test
just replay-l3              # replay-protection demo (run fullflow-l3 first)
just seed deployer 0.1      # seed deployer EOA with 0.1 ETH on Base Sepolia
just seed facilitator 0.1   # seed facilitator EOA with 0.1 ETH on Base Sepolia
```

Run `just` (or `just --list`) to see all available recipes with
one-line descriptions.

### Adding new recipes

1. Update the runbook / leaf script first (runbook is canonical).
2. Add or update the `just` recipe to match.
3. Commit in the order: spec/runbook → recipe → verify.
4. If the recipe body needs more than a single command, put it in
   `tools/scripts/<name>.sh` (not inline bash in the justfile).

## Test conventions (v1.5)

Established at the Prio-2 tightening pass (2026-04-28). Covers the full
test suite through commit `abc03d5` (Prio-2 wrap-up, 112 tests total).
Prio-1 fixes are in commit `9dbde53` (+15 tests, all 46 facilitator green).

### Test layer taxonomy

| Layer | What it tests | Where | Runner |
| ----- | ------------- | ----- | ------ |
| **Unit** | Single pure function: `computePaymentId`, `splitSignature`, `caip2ToChainId`, `buildSettleResponse` | `workers/facilitator/test/{payment-id,eip3009,receipt-builder,state-machine}.test.ts`; `packages/buyer-sdk/test/{payment-id,sign-encode}.test.ts` | Vitest |
| **Route integration** | Full Hono route handler with a fake D1 binding; asserts HTTP status, response body shape, SQL call sequence | `workers/facilitator/test/{settle-route,verify-route}.test.ts`; `workers/agent/test/{index,env-validation}.test.ts` | Vitest |
| **SDK integration** | Real buyer-sdk encode/sign + real facilitator-client request body shape; no live HTTP | `packages/buyer-sdk/test/wire-roundtrip.test.ts`; `packages/{middleware-hono,facilitator-client}/test/*.test.ts` | Vitest |
| **Property / fuzz** | ≥50 structurally varied inputs; determinism, collision resistance | `workers/facilitator/test/payment-id.test.ts` (fuzz describe); `workers/facilitator/test/eip3009.test.ts` (nonce uniqueness) | Vitest |
| **Adversarial sweep** | Malformed/oversized/injected inputs rejected cleanly | `workers/facilitator/test/adversarial.test.ts` | Vitest |
| **Cross-impl byte-equality** | `computePaymentId` re-export from facilitator == buyer-sdk export | `workers/facilitator/test/payment-id.test.ts` (cross-package describe) | Vitest |
| **Foundry unit** | Solidity Splitter contract (constructor, distribute, access control) | `contracts/test/Splitter.t.sol` | Forge |
| **Live integration** | Full on-chain flow against Base Sepolia (not part of `pnpm test`; run manually) | `tools/integration-tests/full-flow-l3.sh`, `replay-l3.sh` | Shell |

### Mocking conventions and known limits

**What IS mocked and why:**

| Mock target | Rationale | Known limit |
| ----------- | --------- | ----------- |
| `settleOnChain` (spy in settle-route tests) | Isolates the D1 state-machine from the two-tx on-chain path | Does not test the viem/RPC path; settle.test.ts covers that separately |
| `viem` `createPublicClient`/`createWalletClient` (settle.test.ts) | Asserts exact contract call arguments without live RPC | Does not verify on-chain revert handling beyond the receipt status |
| `globalThis.fetch` (middleware-hono, facilitator-client, agent tests) | Isolates middleware/SDK from live facilitator HTTP | Does NOT exercise the actual serialization path between buyer and facilitator — wire-roundtrip.test.ts closes this gap |
| Fake D1 (`makeFakeDb`) | Reproduces the exact SQL shapes and state transitions without miniflare | D1's real isolation level is untested (see K.9 open question: miniflare `_real_workerd`) |

**Mocking anti-patterns to avoid (audit lessons):**

- **Mock-passthrough blindspot**: if a mock returns a pre-cooked result without
  exercising real serialization, a field rename or encoding change in the
  production code will pass every unit test and fail live. Fix: `wire-roundtrip.test.ts`
  exercises the actual encode/decode path end-to-end with no intermediate mock.
- **Argument assertions omitted**: mocking `settleOnChain` and asserting only
  its call count is insufficient — assert the exact args it received (auth fields,
  signature bytes, paymentId). All settle-route tests follow this rule.
- **State-only assertions**: asserting the HTTP status without checking the
  D1 row state (or vice versa) leaves the persistence contract untested. The
  richer `makeFakeDb` in settle-route.test.ts records every SQL call for
  shape + parameter assertion.

### No production-code patches from tests

Tests surface bugs; production-code fixes go through their own commit cycle.
If a new test reveals a real production bug:

1. Commit the failing test as-is (the test is expected to fail).
2. Stop and report: minimal repro + suspected fix location.
3. A separate commit (or session) applies the production fix and the test
   goes green in that commit.

Never silently fix a production bug inside the same commit that adds the test.

### How to extend the suite for L4

- **L4a (CCIP-Read gateway)**: add `workers/gateway/test/` following the
  same route-integration pattern as settle-route.test.ts. The CCIP-Read
  `ccipRead` callback and ENS text-record response shape are the key test targets.
- **L4b (signing wrapper Lambda)**: unit tests for the KMS signing adapter
  under `lambda/test/`. Mock `@aws-sdk/client-kms` at the module level
  (same pattern as viem mock in settle.test.ts).
- **L4c (demo frontend)**: Puppeteer browser tests (allowed at L4c per
  the MCP allowlist). Kept separate from the Vitest suite.
- **L4 integration**: update `tools/integration-tests/` with a new script
  (`full-flow-l4.sh`) that drives the KH workflow wallet through the full
  stack. Do NOT modify existing `full-flow-l3.sh` or `replay-l3.sh`.

### Reproducibility + tooling (post-L4a₁ updates)

L4a₁ surfaced three failure modes worth pinning as conventions before L4a₂
extends the gateway worker:

- **One foundry project at repo root.** All Solidity (Splitter, Resolver,
  future contracts) lives in the root `contracts/` Foundry project. Do NOT
  create nested `foundry.toml` files inside worker packages — the L4a₁
  scaffold tried this (`gateway/contracts/` + `gateway/foundry.toml`) and
  shipped a fabricated "9 unit + 1 fuzz tests green" claim because the
  nested project never had `forge install` run. Single root project means
  single `lib/`, single `forge test` covers all contracts, single source
  of truth for solc + evm_version + remappings.

- **Fresh-clone reproducibility is the green-gate.** Every layer's DOD
  requires `git clean -fdx && pnpm install && (cd contracts && forge build
  && forge test) && pnpm test` to pass without manual intervention. Test
  counts reported in commit messages must reflect this fresh-clone run,
  not transient sandbox state. If a contract claim cannot be reproduced
  from a clean checkout, the layer is not green.

- **Wrangler env-bindings are NOT inherited by named environments.**
  `[vars]` and `[[d1_databases]]` declared at the top of `wrangler.toml`
  do NOT automatically propagate into `[env.staging]` or `[env.production]`.
  Every named environment that needs a binding or env var must duplicate
  the block under its own header. Custom-domain `pattern` entries also
  reject `/*` wildcards — use the bare hostname only. Both gotchas
  surfaced during the L4a₁ deploy; preserve in any future worker-deploy
  session.

## L4a deployments (v1, locked)

Deployed 2026-04-28. All gates passed.

**Canonical reproducible tag: `L4a1-gateway-static-green-r2`** (pushed; verified from fresh clone with `git clone --recurse-submodules`). The reproducibility fix landed in commit `bfcd3bf` — Foundry deps re-installed as proper git submodules, gitignore entries blocking `contracts/lib/` removed, root `pnpm test` wired to `pnpm -r run test`. The original tag `L4a1-gateway-static-green` is preserved at the broken commit as historical evidence; do NOT use it for verification or as the L4a₂ pre-flight target.

| Item | Value |
| ---- | ----- |
| Reckon402Resolver (Ethereum Sepolia) | `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` |
| Resolver deploy tx | `0xb658d064556f217be83f322f9800f19dcc07bff61a6dde22f85d7fa28edc945f` |
| Resolver deploy block | `10749903` |
| Resolver deploy signer | `0xFeB56Dc4D71c481B298Bef74C041ae6903eF9EDc` (funder EOA) |
| Etherscan | Verified — https://sepolia.etherscan.io/address/0x479660b8760b32045ff4b9a64f9ba2eef8521f3a#code |
| Initial signer (hot key handle) | Infisical `RECKON402_RESOLVER_SIGNER_PK` (dev env) |
| Gateway D1 database name | `reckon402-d1-gateway-dev` |
| Gateway D1 database ID | `926ca731-4952-438e-a70c-f19722dc25b0` |
| Gateway staging URL | `https://gateway-staging.reckon402.com` |
| Gateway prod URL | `https://gateway.reckon402.com` |
| Gateway staging version ID | `cc70404f-2e9f-4694-9ffe-af6ed31b02ec` |
| Gateway prod version ID | `5e697d8d-f46f-4aea-8e6d-544609e18e47` |
| Wrangler secrets | `RECKON402_RESOLVER_SIGNER_PK`, `ETH_SEPOLIA_RPC_PRIMARY` (staging + production) |
| ENS name | `reckon402-test.eth` on Ethereum Sepolia (chainId 11155111) |
| ENS registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| ENS swap tx | `0xc852b44767e2318d24ac024f83e2be9342f2e25bdfe566157cdcf076519bf975` |
| ENS swap block | `10750233` |
| Sepolia UniversalResolver | `0xeeeeeeee14d718c2b47d9923deab1335e144eeee` (viem built-in) |
| Sepolia RPC key handle | Infisical `ETH_SEPOLIA_RPC_PRIMARY` (dev env) |
| `ENABLE_ERC8004_READS` shipped as | `"false"` |
| `STEALTH_ENABLED` shipped as | `"false"` |
| Spec | `specs/04-l4a-gateway.md` |
| ENS resolver runbook | `tools/ens/set-resolver.md` |
| HTTP tester | `tools/integration-tests/resolve-l4a.sh` |

Smoke test results:
- `resolve-l4a.sh` vs staging: PASS (exit 0, value `https://facilitator.reckon402.com`, age 1s, sig 132 chars)
- `resolve-l4a.sh` vs production: PASS (exit 0, value `https://facilitator.reckon402.com`, age 2s, sig 132 chars)
- ENS end-to-end via viem `getEnsText` → Sepolia UniversalResolver → Reckon402Resolver → CCIP-Read → gateway → D1:
  - `seller.reckon402-test.eth` → `x402.facilitator` = `https://facilitator.reckon402.com` PASS
  - `seller.reckon402-test.eth` → `x402.splitter` = `0x0ad507c6973eba86313794329ad9b12fbf24acd0` PASS
- Forge: 39/39 green from fresh clone (1 SplitterFork + 20 Splitter unit + 3 Splitter invariant + 15 Resolver)
- Vitest: 153/153 green via `pnpm -r run test` from fresh clone (41 gateway + 63 facilitator + 13 buyer-sdk + 15 middleware-hono + 12 facilitator-client + 9 agent)

Canonical tag (reproducible): `L4a1-gateway-static-green-r2` (pushed to origin/main). Original tag `L4a1-gateway-static-green` preserved at the broken commit as historical evidence; do not use for verification.

## L4a2 ERC-8004 client + reads (v1, locked)

Shipped 2026-04-28. All gates passed.

**Canonical reproducible tag: `L4a2-erc8004-reads-green`** (pushed;
verified from fresh clone with `git clone --recurse-submodules`).

### New workspace entry

| Item | Value |
| ---- | ----- |
| Package name | `@reckon402/erc-8004-client` (public scope `@reckon402`) |
| Location | `packages/erc-8004-client/` |
| Upstream ABI pin (SHA) | `0463311492b3a7fc5fdb6990231cce721ff6cf97` (exported as `UPSTREAM_ABI_COMMIT`) |
| Spec sections | `specs/04-l4a-gateway.md` §11–§18 |

### Pinned multichain config

| Chain | chainId | Identity | Reputation | Validation |
|-------|---------|----------|------------|------------|
| Base Sepolia | 84532 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `null` |
| Base Mainnet | 8453 | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `null` |
| Ethereum Sepolia | 11155111 | (same as Base Sepolia) | (same as Base Sepolia) | `null` |
| Ethereum Mainnet | 1 | (same as Base Mainnet) | (same as Base Mainnet) | `null` |

`ValidationRegistry` is `null` on all four chains at the pinned commit
(upstream: "under active TEE-community discussion"). Library surfaces
are implemented but every call throws `VALIDATION_NOT_DEPLOYED`.

### Gateway deployments

| Item | Value |
| ---- | ----- |
| Gateway staging URL | `https://gateway-staging.reckon402.com` |
| Gateway prod URL | `https://gateway.reckon402.com` |
| Gateway staging version ID | `78cbc720-af0b-4792-8b59-26ad63a9d0f0` |
| Gateway prod version ID | `9a01a477-b234-4f30-8f32-47737c0148bf` |
| `ENABLE_ERC8004_READS` shipped as | `"true"` |
| New wrangler secrets (staging + production) | `BASE_SEPOLIA_RPC`, `GATEWAY_CACHE_HOOK_TOKEN` |
| New wrangler vars | `ENABLE_ERC8004_READS=true`, `BASE_MAINNET_RPC=""` (placeholder), `CACHE_TTL_REPUTATION_S=300` |
| D1 migration applied | `gateway/migrations/0002_erc8004_cache.sql` (erc8004_cache + agent_id_index) |
| D1 seed applied | `gateway/migrations/seed_l4a2.sql` (adds `x402.amount="100000"` on `seller.reckon402-test.eth`; maps it to Base Sepolia agentId=1) |
| Known agents inventory | `tools/integration-tests/known-agents.md` |
| HTTP tester | `tools/integration-tests/resolve-l4a.sh --backend {static,erc8004}` |

### Behavioral notes (deviations from design-doc hints)

- `getSummary` requires explicit `clientAddresses`. Upstream reverts
  on empty array (`"clientAddresses required"`). The library exposes
  `reputation.getSummaryForAllClients` which does the two-step
  `getClients` → `getSummary` read and caches both.
- `identity.getAgent` is a library-side composite (`ownerOf +
  getAgentWallet + tokenURI`); upstream has no such function.
- Event names: upstream uses `Registered` not `AgentRegistered`;
  `NewFeedback` not `FeedbackGiven`. ABI subsets use upstream names.
- `reputation.giveFeedback` has 8 args upstream
  (`agentId, value:int128, valueDecimals:uint8, tag1, tag2, endpoint,
  feedbackURI, feedbackHash`) — not the 6 the M.0 handoff sketch
  suggested.
- D1 `LIKE` with our canonical cache-key prefix is rejected with
  `SQLITE_ERROR 7500 "pattern too complex"`. The cache-invalidate
  hook uses `substr(cache_key, 1, ?) = ?` for prefix match. Surfaced
  during staging deploy smoke, fixed mid-session.

### Smoke test results (post-deploy)

- `resolve-l4a.sh --backend static` vs staging + production: PASS
  (regression guard; byte-equal to L4a₁).
- `resolve-l4a.sh --backend erc8004` vs staging + production: PASS
  (returns `value=100000` — base price; agent 1 has 0
  `"payment"/"x402-settlement"`-tagged feedback entries on Base
  Sepolia at 2026-04-28, so tier bps = 0. L4b settle-hook will seed
  the tagged feedback that drives the demo Act-1 pricing story).
- Cache populated on first read: confirmed via direct D1 query
  (`reputation.getClients:92f39bdb...` + `reputation.getSummary:45b36d9a...`).
- Cache-invalidate hook end-to-end: POST `/hooks/cache-invalidate`
  with valid bearer token deletes both cache rows (`deleted: 2`),
  follow-up `SELECT cache_key FROM erc8004_cache` returns zero rows.
  401 on missing / wrong token.
- Forge: 39/39 green from fresh clone (unchanged from L4a₁).
- Vitest: 224/224 green via `pnpm -r run test` from fresh clone, of
  which 56/56 in the new `@reckon402/erc-8004-client` with live
  `BASE_SEPOLIA_RPC` hydrated (53/53 offline, 3 live-RPC tests
  skipped when unset).

### Known forward-compat / L4b carryover

- Real writes to Identity / Reputation registries (L4b).
- Cache-invalidate hook **call side** — facilitator hitting the
  receive-side hook after a confirmed settle (L4b).
- KMS signing wrapper for writes (L4b).
- Reputation-gated resolution (gateway blocks resolve if summary
  below threshold) — L4c demo.
- ValidationRegistry — blocked on upstream deployment.
- ENS mainnet registration — post-hackathon.

## LLM-friendly tech docs

Curated, LLM-optimised reference docs live under `LLM_friendly_tech_docs/`
(local-only, gitignored — fetched out-of-band, not committed).
**Before writing any code that touches a covered technology, read the
corresponding doc(s) first** — they are the authoritative source of truth
for API surface, wire formats, and gotchas for this project.

| Technology | Files |
|------------|-------|
| ENS | `LLM_friendly_tech_docs/ens/llms.txt` (index), `LLM_friendly_tech_docs/ens/llms-full.txt` (full reference) |

When writing ENS-related code (name resolution, reverse resolution,
CCIP-Read, ENS wildcard, `gateway.reckon402.com` off-chain resolver, ENS
subname registration), read `LLM_friendly_tech_docs/ens/llms-full.txt`
before producing any implementation. Do not rely on pre-training
knowledge alone for ENS — the docs cover breaking changes and current
API conventions that differ from older patterns.

## L4b1 ERC-8004 attestation writes (v1, locked)

Shipped 2026-04-29. All gates passed. First live `NewFeedback` event
emitted from the Reckon402 facilitator to Base Sepolia's
ReputationRegistry. Closed read↔write loop proven: the post-
attestation gateway reputation read returned the first-tier discount
price (`95000` vs base `100000`).

**Canonical reproducible tag: `L4b1-erc8004-writes-green`** (pushed;
verified from fresh clone with `git clone --recurse-submodules`).

### Deployed state

| Item | Value |
| ---- | ----- |
| Facilitator flag-off version ID | `99039af0-0357-45a4-a7fe-9f6044f8a531` |
| Facilitator flag-on version ID  | `b02d55e6-4c8e-4663-bf58-84f001ab30c1` |
| Facilitator worker URL | `https://facilitator.reckon402.com` |
| D1 migration applied | `workers/facilitator/migrations/0002_l4b_writes.sql` (adds `attestations.failure_detail`) |
| `ENABLE_ERC8004_WRITES` shipped as | `"true"` |
| `SELLER_AGENT_IDS` wrangler var | `{"0xd53ffac42496d73b3faf946786688a8454f57b1f":"1"}` |
| New wrangler secrets | `GATEWAY_CACHE_HOOK_TOKEN` (shared value with gateway worker from L4a2) |
| Spec | `specs/07-l4b-erc8004-writes.md` |
| Framing locks | `specs/06-actor-act-matrix.md` (D1–D14) |
| Deploy runbook | `tools/deploy/deploy-l4b.md` |
| Secrets runbook | `tools/deploy/secrets-l4b.md` |
| Smoke script | `tools/integration-tests/full-flow-l4b.sh` + `just fullflow-l4b` |

### First live attestation

| Field | Value |
| ----- | ----- |
| paymentId | `0x9735e05eca7a3219438f3a4a103ef86e4b9419860f8b7c6ce0274ac2462f5ce3` |
| Settlement tx (transferWithAuthorization) | `0xce89c9c68ce24ffe32015db6ec5c9458c97998464aa5af6300b0e3b599667b5b` |
| Attestation tx (giveFeedback) | `0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2` |
| Basescan (attestation) | https://sepolia.basescan.org/tx/0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2 |
| On-chain `NewFeedback` event | `agentId=1`, `clientAddress=0x0A0228…c455` (facilitator EOA per D3), `tag1="payment"`, `tag2="x402-settlement"`, feedbackURI encodes the paymentId per `ATTESTATION_FEEDBACK_URI_PREFIX` |
| Gas used | 198_444 (~$0.00005 at Base Sepolia fees) |

### Smoke + regression outcomes

- `full-flow-l3.sh` (post-flag-off deploy): PASS — L3 regression holds.
- `replay-l3.sh` (post-flag-off deploy): PASS — idempotency preserved.
- `full-flow-l4b.sh` → live settlement + live attestation landed in
  both the `attestations` table (row present) and `receipts.td_erc8004_tx`
  column.
- Gateway cache invalidated: `resolve-l4a.sh --backend erc8004 --key
  x402.amount` returns `value=95000` (first-tier discount, count=1).
- Forge: 39/39 green from fresh clone (unchanged from L4a2).
- Vitest: 240 passed + 3 skipped via `pnpm -r run test` from fresh
  clone. Net +16 on the facilitator worker
  (63 → 79: +7 agent-resolver + +9 attestation tests). No regressions
  elsewhere.

### Behavioural notes / deviations from the design pack

- **Trigger is inline `ctx.waitUntil`, not a Cron Trigger watcher.**
  The design-pack `02_facilitator.md` §10.1 Option A (polling
  `eth_getLogs` for Splitter `Distributed` events) is superseded.
  Rationale locked in `specs/06-actor-act-matrix.md` D6: the
  facilitator submits `distribute()` itself, so the settlement
  signal is already in-process. No `watcher_state` D1 table exists.
- **Facilitator, not buyer, signs `giveFeedback`.** Locked in
  D3: the DXb rail records facilitator-observed settlement
  attestations (tags `("payment","x402-settlement")`,
  `clientAddress=facilitator`), not DXa buyer-satisfaction reviews.
  Buyer EOAs never appear in Reckon402-written reputation records
  (automatic pseudonymity). DXa permanently not shipped (D13).
- **Receipt JSON does not yet surface `td_erc8004_tx`.** The D1
  column is populated correctly; surfacing it in the Receipt shape
  is a v1.5 polish item on `receipt-builder.ts`. Not demo-blocking.
- **`SELLER_AGENT_IDS` is a JSON-encoded map, not a single env
  var.** Resolution seam lives in `src/treasury/agent-resolver.ts`;
  swapping to per-merchant ENS `x402.agent_id` text-record reads
  is a drop-in change inside that function (v1.5).

### Known forward-compat / L4b2 carryover

- Lambda signing wrapper + KH skill + recipes (L4b2, independent of
  L4b1). Lambda ships unchanged per `04_signing_wrapper.md`.
- ENS-driven agent resolution (Q-07-1, v1.5).
- Per-merchant `x402.attestation` ENS opt-in (Q-07-2, v1.5 —
  the hackathon uses the master `ENABLE_ERC8004_WRITES` boolean).
- Deterministic feedbackHash canonicalization (Q-07-3, v1.5).
- Retry reconciler for failed attestation writes (Q-07-5, v1.5 —
  the `failure_detail` column is in place; the sweep logic is not).
- Receipt JSON exposing `td_erc8004_tx` (v1.5 polish).

## L4b framing lock (2026-04-29)

Actor/act/signer/broadcaster/gas-payer matrix is locked in
`specs/06-actor-act-matrix.md`. L4b1 (ERC-8004 settlement-attestation
write) implements **DXb — facilitator-observed settlement**, not DXa
(buyer satisfaction). Summary of the load-bearing decisions:

- **Facilitator signs AND broadcasts `giveFeedback`** with
  `FACILITATOR_PK`. The `clientAddress` recorded on-chain is
  intentionally the facilitator EOA. Tags are pinned to
  `("payment", "x402-settlement")`. Buyer EOAs never appear in
  Reckon402-written reputation records (automatic pseudonymity).
- **Trigger is inline `ctx.waitUntil(...)` in
  `workers/facilitator/src/settle.ts`**, not a cron-driven event
  watcher. The facilitator submits `distribute()` itself, so it
  already has the settlement signal in-process. The spec-pack's
  `02_facilitator.md` §10.1 Cron watcher is superseded by this
  decision; no `watcher_state` D1 table is created.
- **Lambda signing wrapper (`04_signing_wrapper.md`) ships unchanged
  — single endpoint, EIP-3009 scope only.** D3's "facilitator signs
  attestations" resolves the question of a second endpoint to "no".
  §4.6 "no arbitrary digest path" discipline is preserved.
- **DXa (buyer satisfaction attestations) is not shipped**, not even
  as an optional API. Rationale: shipping DXa side-by-side with DXb
  forces downstream consumers to weight two signals, which creates
  either a sybil surface (high weight) or an under-weighted
  irrelevance (low weight). The ReputationRegistry slot stays open
  for another primitive to fill with its own tag family.
- **Gas for attestations is paid by the facilitator** from the
  EIP-3009 fee slot. Same funding source as `transferWithAuthorization`
  and `distribute()`. Per-write cost at Base is ~$0.0002 (~2% of a
  0.01 USDC settlement). Per-settlement writes are hackathon- and
  production-economic at Base gas levels. Batching is a v1.5 path
  (conditional on gas shifting; also unlocks buyer privacy).
- **ValidationRegistry** writes are blocked upstream (`null` address
  at the pinned commit across every supported chain). Library
  surfaces throw `VALIDATION_NOT_DEPLOYED`. Revisit when upstream
  ships.
- **Reckon402 is a facilitator, not an agent platform.** D9 Path A is
  locked for the hackathon — sellers register their own agents in
  IdentityRegistry; Reckon402 does not operate an identity factory or
  tokenize agent revenue streams. Path B (platform direction) is a
  post-hackathon roadmap slot.

Any new layer that adds an on-chain or off-chain act cross-checks
against `specs/06-actor-act-matrix.md` before committing to an
implementation.

## L4b2 signing wrapper + KH skill + recipes (v1, locked)

Shipped 2026-04-29. All gates passed.

**Canonical reproducible tag: `L4b2-signing-kh-green`** (pushed;
verified from fresh clone with `git clone --recurse-submodules`).

### Deployed state

| Item | Value |
|------|-------|
| Lambda function | `reckon402-signing-wrapper` (Node.js 20, eu-central-1) |
| Lambda execution role | `reckon402-signing-wrapper-role` |
| KMS key (buyer-signer) | `5a0350e0-d502-4579-8d45-d31c843a5f3f` |
| API Gateway HTTP API | `hsnyt8en0a` (eu-central-1) |
| Custom domain | `signing.reckon402.com` → `d-hvxxmx7mo8.execute-api.eu-central-1.amazonaws.com` |
| ACM certificate | `arn:aws:acm:eu-central-1:975170806362:certificate/436c3ccf-c1cf-415e-aaa0-e90e19524191` (ISSUED) |
| Cloudflare CNAME | `signing.reckon402.com` → `d-hvxxmx7mo8.execute-api.eu-central-1.amazonaws.com` |
| `SIGNING_WRAPPER_API_KEY` | Infisical `reckon402/dev/SIGNING_WRAPPER_API_KEY` |
| Spec | `specs/08-l4b2-signing-wrapper.md` |
| Lambda source | `lambda/signing/` |
| KH workflow | `recipes/kh-workflow.json` |
| KH skill | `packages/kh-skill/` (`@reckon402/kh-skill`) |
| Recipes | `recipes/curl-recipe.sh`, `viem-recipe.ts`, `python-recipe.py` |
| FEEDBACK.md | `FEEDBACK.md` (KH builder feedback bounty) |

### Integration smoke output (2026-04-29, live evidence)

```
POST https://signing.reckon402.com/sign
  X-Api-Key: <SIGNING_WRAPPER_API_KEY>
  body: { typedData: { domain: { name:"USD Coin", version:"2", chainId:84532,
           verifyingContract:"0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
           primaryType:"TransferWithAuthorization",
           message: { from:"0x46bbb05aca9ea24118b8a57c8d3f317503384305",
                      to:"0x0ad507c6973eba86313794329ad9b12fbf24acd0",
                      value:"10000", validAfter:"0", ... } } }

→ {"signature":"0xc5fc3baf295420488aa3fb67a2f672430da419d36d081ddf826e78bc30d1c84d679d989f10e76b2b25ebbf2c33c19ce9fe39e098a0be2ee2c98c5f3e2d24ec7c1b",
   "signerAddress":"0x46bbb05aca9ea24118b8a57c8d3f317503384305"}

SMOKE PASS: signerAddress matches pinned KMS buyer-signer EOA
```

### Smoke + regression outcomes

- `GET https://signing.reckon402.com/healthz` → `{"status":"ok","kms_reachable":true,"signer_eoa":"0x46bbb05aca9ea24118b8a57c8d3f317503384305"}` PASS
- `POST https://signing.reckon402.com/sign` with valid USDC Base Sepolia payload → signature recovers to `0x46bbb05aca9ea24118b8a57c8d3f317503384305` PASS
- Forge: 39/39 green from fresh clone (unchanged).
- Vitest: 256 passed + 3 skipped (259 total) via `pnpm -r run test` from fresh clone. Net +16 on `lambda/signing` (3 test files, 16 tests: DER parse, low-S normalization, validation guards).

### Behavioural notes

- **`@aws-sdk/client-kms` is NOT bundled** — Lambda Node.js 20 runtime includes `@aws-sdk/client-kms` v3. The handler is bundled with esbuild (`--external:@aws-sdk/client-kms`) so viem + zod are inlined (260KB bundle), AWS SDK consumed from Lambda runtime.
- **Auth is `X-Api-Key` header** (not `Authorization: Bearer` per the design doc) — simpler for KH workflow config; the doc spec is updated in `specs/08-l4b2-signing-wrapper.md`.
- **KH skill is a stub** — `packages/kh-skill/src/index.ts` defines the skill interface and routes through `@reckon402/buyer-sdk`; the KH manifest format (`manifest.yaml`) is deferred until KH docs confirm the exact schema at H-9.
- **Shared KMS key** — the buyer-signer key (`0x46bbb05aca9ea24118b8a57c8d3f317503384305`) is the same EOA used by L4b1's facilitator attestation writes. Design intent: same EOA acts as both demo buyer and ERC-8004 attestation writer. Documented in the L4b framing lock section above.

### Known forward-compat / H-9 carryover

- KH skill manifest format validation (confirm KH `manifest.yaml` schema at H-9).
- KH workflow JSON schema validation against live KH builder API (Q-R1 from design doc).
- Full end-to-end KH workflow run against staging (demo dress-rehearsal, H-9 morning).
- `python-recipe.py` marked drop-flagged but shipped — Q-R7 resolved keep.
- Lambda provisioned concurrency (Q-W4) deferred — warm p50 is ~80ms, acceptable.

## Demo Infrastructure (2026-04-29)

Shipped at tag `demo-infra-green`.

| Item | Value |
|------|-------|
| Demo dashboard URL | `https://demo.reckon402.com` (CF Pages — see note below) |
| CF Pages project name | `reckon402-demo` (to be created — see `demo/DEPLOY.md`) |
| Dashboard source | `demo/index.html` (vanilla HTML + Tailwind CDN; no build step) |
| Demo e2e script | `scripts/demo-e2e.sh` |
| KH platform runbook | `tools/deploy/kh-platform-runbook.md` |
| KH workflow URL | _TODO: paste after manual publish at app.keeperhub.com_ |

### CF Pages deploy status

The CF API token in Infisical lacks `Pages:Edit` scope. The first deploy is a
manual step — follow `demo/DEPLOY.md`. Once the project exists, add:

```
just deploy-demo   # npx wrangler pages deploy demo/ --project-name reckon402-demo
```

Update the table above with the Pages project URL once it is created.

### Running the demo script

```bash
# Requires: Infisical secrets BUYER_DEMO_1_PK, SPLITTER_ADDRESS, BASE_SEPOLIA_RPC_PRIMARY
infisical run --env dev --domain https://secrets.intentralabs.com -- \
  bash -c 'bash scripts/demo-e2e.sh'
```

Testnet-specific env var defaults (no override needed for standard testnet run):
- `AGENT_URL=https://agent.reckon402.com`
- `FACILITATOR_URL=https://facilitator.reckon402.com`
- `GATEWAY_URL=https://gateway.reckon402.com`
- `SELLER_NAME=seller.reckon402-test.eth`

### KH workflow

`recipes/kh-workflow.json` is the importable workflow definition.
See `tools/deploy/kh-platform-runbook.md` for import steps. Once published,
update the KH workflow URL row in the table above.

## Landing Page + Packages (2026-04-29)

### reckon402.com CF Pages

| Item | Value |
|------|-------|
| CF Pages project name | `reckon402-landing` (to be created — see `landing/DEPLOY.md`) |
| Source directory | `landing/` |
| Landing page | `landing/index.html` (vanilla HTML + Tailwind CDN; no build step) |
| Deploy runbook | `landing/DEPLOY.md` |
| Last deploy | _TODO: paste after first manual deploy_ |
| Custom domain | `reckon402.com` |

The CF API token in Infisical may lack `Pages:Edit` scope. The first deploy
is a manual step — follow `landing/DEPLOY.md`. Once the project exists, add:

```
just deploy-landing   # npx wrangler pages deploy landing/ --project-name reckon402-landing
```

**TODO-HEADLINE:** The hero headline in `landing/index.html` is currently
`"Every agent payment, reckoned."` (placeholder). Replace with the final
one-sentence pitch once the F analysis is complete.

### npm package publish-readiness (as of 2026-04-29)

| Package | Status | Notes |
|---------|--------|-------|
| `@reckon402/buyer-sdk` | ready | `publishConfig`, `build`, `prepublishOnly` all set |
| `@reckon402/erc-8004-client` | ready | `publishConfig`, `build`, `prepublishOnly` all set |
| `@reckon402/middleware-hono` | ready | `publishConfig`, `build`, `prepublishOnly` all set |
| `@reckon402/kh-skill` | ready | `publishConfig`, `build` set; `prepublishOnly` build-only (no test suite yet) |
| `@reckon402/types` | NOT ready | workspace-only today; no `publishConfig` or `build` script; add before H-9 |

All four public packages have:
- `"publishConfig": {"access": "public"}` — with dist entry-points
- `"build"` script: `tsc -p tsconfig.build.json`
- `"prepublishOnly"` script (build + test for packages with test suites)
- `tsconfig.build.json` (`dist/`, NodeNext module mode, declarations)
- `"files": ["dist", "src"]` — test files and source maps excluded (no test/ in files)

Publish runbook: `tools/deploy/npm-publish-runbook.md`

**Do NOT publish during L2–L4 build commits.** Optional H-9 polish step.

### Seller agent response (2026-04-29)

`workers/agent/src/index.ts` `/research` handler upgraded from canned stub to
live chain-health response: fetches `eth_blockNumber` from the public Base Sepolia
RPC (`https://sepolia.base.org`) and returns:

```json
{
  "query": "<buyer's query string>",
  "result": {
    "chain": "Base Sepolia",
    "latestBlock": 12345678,
    "timestamp": "2026-04-29T12:34:56Z",
    "summary": "Base Sepolia is healthy. Current block: 12345678. Network producing blocks normally."
  },
  "meta": { "paymentId": "0x...", "paidAt": "2026-04-29T..." }
}
```

Graceful fallback if RPC is unreachable (AbortSignal.timeout 4s): returns
`latestBlock: null` with a `"temporarily unreachable"` summary. Tests updated;
9/9 green.

## L4c SplitterFactory + per-payment resolution

Spec source: `specs/08a-l4c-factory-refactor.md`. Lifts the single-
`SPLITTER_ADDRESS`-per-facilitator constraint baked into L3/L4b₁. One
facilitator serves N SellingAgents; each SellingAgent owns their own
Splitter deployed via CREATE2 through a shared `SplitterFactory`.

### Contracts

- `contracts/src/SplitterFactory.sol` — CREATE2 factory.
  `createSplitter(sellingAgent, recipients, bps, salt)` deploys a per-
  SellingAgent Splitter, emits `SplitterCreated(sellingAgent, splitter,
  salt, recipients, bps)`, and marks `isDeployed[splitter] = true`.
  `predictAddress(salt, recipients, bps)` gives the deterministic
  address for the onboarding script to pre-fill the `x402.splitter`
  ENS record. No admin, no upgrade. SellingAgent MUST equal `recipients[0]`
  (slot 0 = seller by L3 Splitter convention).
- `contracts/test/SplitterFactory.t.sol` — 10/10 cases green (happy path,
  duplicate-salt revert, input validation, bubbled Splitter reverts,
  predictAddress round-trip, 256-case fuzz on salt).
- `contracts/script/DeploySplitterFactory.s.sol` — Foundry deploy script.
  Env: `SPLITTER_FACTORY_TOKEN` (USDC on Base Sepolia).

### Facilitator worker

- `workers/facilitator/src/treasury/splitter-resolver.ts` — per-payment
  resolver. Reads `x402.splitter` + `x402.erc8004.agent_id` from the
  gateway via a single `GET /records/:ensName?flat=true&backend=static`
  call (flat-records endpoint, NOT the CCIP-Read `/lookup/` path).
  Validates the splitter came from our factory via
  `SplitterFactory.isDeployed`, returns `{splitter, agentId, ensName}`
  or `null` on any failure. Never throws.
- `workers/facilitator/src/settle-route.ts` — when `ENABLE_L4C_FACTORY=
  "true"`, runs splitter resolution BEFORE the SUBMITTED →
  PENDING_CONFIRMATION claim. Missing/forged record transitions the
  receipt to a new terminal state `SPLITTER_UNKNOWN` and returns HTTP
  422 `{error: "splitter_unknown", ensName}`. No gas is spent in the
  forged-record case. The resolved splitter is threaded into
  `settleOnChain` as `input.splitter` (falls back to
  `env.SPLITTER_ADDRESS` when the flag is off).
- `workers/facilitator/src/settle.ts` — accepts `splitter` per-payment
  via `SettleInput.splitter`; `env.SPLITTER_ADDRESS` is now a
  deprecated fallback used only when the flag is off.
- `workers/facilitator/src/treasury/attestation.ts` — L4c: when
  `input.resolved` is present, `agentId` is taken verbatim from it
  (gateway + factory validated) and the legacy JSON-map resolver is
  NEVER consulted. L4b₁ legacy path is gated on
  `USE_LEGACY_AGENT_RESOLVER="true"`.
- `workers/facilitator/src/state-machine.ts` — `SPLITTER_UNKNOWN` added
  as a terminal state with only `SUBMITTED → SPLITTER_UNKNOWN` allowed.
  Not in the retry-reconciler's sweep scope.

### Env + migration

New `wrangler.toml [vars]`:

| Var | Default | Purpose |
|-----|---------|---------|
| `SPLITTER_FACTORY_ADDRESS` | `""` | v1 factory on Base Sepolia; populated at deploy time. |
| `GATEWAY_BASE_URL` | `https://gateway.reckon402.com` | Base URL for `x402.splitter` + `x402.erc8004.agent_id` lookups. |
| `ENABLE_L4C_FACTORY` | `"false"` | Master switch: `false`=legacy single-splitter; `true`=per-payment resolution. |
| `USE_LEGACY_AGENT_RESOLVER` | `"true"` | Keeps L4b₁ JSON-map fallback live for regression; flip to `"false"` after smoke. |

Deprecated (kept for flag-off regression only): `SPLITTER_ADDRESS`,
`SELLER_AGENT_IDS`.

Migration `workers/facilitator/migrations/0003_l4c_splitter_factory.sql`
adds a `deployment_config` kv table; the factory address is written there
once at deploy time for audit + cold-start logging.

### Tests

- Vitest: 97/97 green.
  - `test/splitter-resolver.test.ts` — 10 cases (happy path; gateway 404
    on each record; malformed splitter; agentId = "0" / non-numeric;
    factory `isDeployed=false`; factory RPC throws; checksum
    normalization; parallel fetch dispatch discipline). Every mock call
    asserts full arg shapes per `feedback_testing.md`.
  - `test/settle-route-factory.test.ts` — 6 cases (flag-off legacy;
    flag-on resolver=null → 422 + SPLITTER_UNKNOWN + no tx; flag-on
    missing ens → 400; flag-on happy path threads splitter into
    `settleOnChain`; state-machine allowlist; L4b₁ regression shape).
  - `test/attestation.test.ts` — L4c regression cases: `resolved.agentId`
    used directly (legacy `resolveAgentId` never called); `resolved=null`
    + `USE_LEGACY_AGENT_RESOLVER="false"` → silent skip.
- Forge: 10/10 on `SplitterFactoryTest`.

### Deployment

**Status: SHIPPED 2026-05-01 — tag `L4c-factory-green`**

#### On-chain addresses

| Contract | Address | Block | Tx |
|----------|---------|-------|----|
| SplitterFactory (v1) | `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7` | 40932143 | `0x2d77e747000edceed7d63d6ce19f890c0ca676eadd3cc8e12e7dd721e323134c` |
| seller.reckon402-test.eth Splitter (via factory) | `0x372c0b951035da05058b175a15b4fe7d29f1fc4c` | 40932952 | (seed-factory-splitter.mjs) |
| Deployer (KMS) | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | — | `alias/reckon402/mainnet/deployer/evm` |

Deploy log: `contracts/deploy-logs/splitter-factory-base-sepolia-2026-05-01.md`

#### Worker deploy sequence (completed)

| Step | Action | Facilitator version |
|------|--------|-------------------|
| 1 | Flag-off deploy (`ENABLE_L4C_FACTORY="false"`) — L4b regression smoke | `847bdecb-...` |
| 2 | Flag-on deploy (`ENABLE_L4C_FACTORY="true"`) — L4c smoke (SPLITTER_UNKNOWN path live) | `bf35d4a3-...` |
| 3 | Legacy-off deploy (`USE_LEGACY_AGENT_RESOLVER="false"`) — final smoke PASS | `dc14eb8e-6537-43ea-a991-f3896ffdb152` |

Gateway version at L4c-green: `3d9c120f-...` (redeployed with `--env production` to expose `/records/:ensName` flat-records endpoint)

D1 migrations applied to `reckon402-d1-facilitator-dev` (remote):
- `0003_l4c_splitter_factory.sql` — `deployment_config` kv table; factory address written at deploy
- `0004_l4c_splitter_unknown_state.sql` — table-rebuild to add `SPLITTER_UNKNOWN` to receipts CHECK constraint

#### Smoke results (2026-05-01T11:45:15Z)

Scenario A — happy path (`seller.reckon402-test.eth`, splitter `0x372c0b...`):
- settle HTTP 200, state `CONFIRMED`
- settlement tx: `0x95c8d8aae62205de765eeb56d17bbd6166114dd949605825c38c6dd82d37489c`
- attestation tx: `0xc67037b166fa55fe6f093f861fe9f56e9697e263840e1c1709de3b4138be2e8a`

Scenario B — forged splitter (`seller-forged.reckon402-test.eth`, splitter `0x0ad507...` not in factory):
- settle HTTP 422 `splitter_unknown`, state `SPLITTER_UNKNOWN`, transaction empty

Results file: `tools/integration-tests/results-full-flow-l4c-factory-2026-05-01T11-45-15Z.md`

#### Re-run

```
just fullflow-l4c-factory
```

## L4c Onboarding + signed writes + frontend (Spec 08B)

### Scope shipped

- `tools/onboard/` — Node CLI `tsx tools/onboard/src/cli.ts` (also
  exposed as `just onboard <ens> <sellerEoa>`). Five step modules
  (mint-subname / deploy-splitter / register-agent-id / set-ens-records
  / seed-gateway) under `tools/onboard/src/steps/`.
  Orchestrator composes them in `src/orchestrator.ts`.
  Vitest: 24/24 green (one suite per step module + 5 orchestrator cases
  with full-arg assertions per `feedback_testing.md`).
- `gateway/src/ens/owner-lookup.ts` — `getEnsOwner(env, ensName)` reader
  for `ENSRegistry.owner(namehash(ensName))` on Ethereum Sepolia with
  60s D1-cached responses. Returns null on any failure (ACL denies by
  default). 9/9 vitest green.
- `gateway/src/routes/admin/` — `auth.ts` (signed-write digest +
  signer recovery), `records.ts` (per-key ACL enforcement with
  bootstrap-window exception), `bootstrap.ts` (Reckon402-signed batch
  seed + `/gateway-seed` endpoint that upserts both `agent_id_index`
  and `merchants.records`). ACL table in `gateway/src/lib/acl.ts`.
  17/17 vitest cases covering spec §7.1 (signature mismatch, replay
  guard via `UNIQUE(ens_name, nonce)`, bootstrap-window one-way door,
  ACL deny/allow matrix).
- `gateway/migrations/0003_l4c_signed_writes.sql` — adds
  `record_updates`, `ens_owner_cache`, `onboard_progress` tables. No
  changes to existing L4a₁/L4a₂ tables. Shared with onboard-orchestrator.
- `workers/onboard-orchestrator/` — CF Worker exposing `POST /onboard`
  (202 + `{onboardId}` immediately; runOnboard in `ctx.waitUntil`),
  `GET /onboard/:id/status` (progress poll), `GET /healthz`. Static
  assets for the frontend served via Workers Assets binding at
  `apps/frontend/dist/`. 13/13 vitest cases covering the HTTP surface
  + progress-store round-trip.
- `apps/frontend/` — vanilla-TS single-page app with onboarding form +
  dashboard (ENS/agentId/Splitter, static tier table, call log,
  Option C terminal pane per `demo_narrative.md`). Served from
  same-origin as orchestrator worker → no CORS. Polls every 3s.
- `tools/integration-tests/full-flow-l4c-onboard.sh` — end-to-end smoke:
  POST /onboard → status=succeeded → gateway records served → paid call
  → post-attestation discount reflected in `x402.amount?backend=erc8004`.

### ACL (per `ens_record_ownership_split.md`)

| Key                         | Writer       |
|-----------------------------|--------------|
| `x402.splitter`             | Reckon402    |
| `x402.facilitator`          | Reckon402    |
| `x402.erc8004.registry`     | Reckon402    |
| `x402.erc8004.agent_id`     | Reckon402    |
| `x402.amount`               | SellingAgent |
| `x402.pricing`              | SellingAgent |
| `x402.endpoint`             | SellingAgent |
| `x402.attestation`          | SellingAgent |
| `x402.yield`                | SellingAgent |
| `x402.scheme`/`.version`/`.asset` | SellingAgent |

Bootstrap window: while `owner(namehash(ensName))` equals
`RECKON402_ONBOARDING_EOA`, Reckon402 may also write SellingAgent keys.
The final `setOwner(subnode, seller)` in step 5 of onboarding closes
this window. Once closed, Reckon402 /admin/records calls for
SellingAgent keys return 403.

### Signed-write digest

`digest = keccak256(abi.encode(chainId, ensName, key, value, nonce))`

- `chainId` = Ethereum Sepolia (`11155111`). ENS ownership is on
  Ethereum Sepolia; binding the digest to that chainId prevents
  cross-chain replay.
- `nonce` is a 32-byte random value. UNIQUE(ens_name, nonce) in
  `record_updates` is the replay guard — second call with same tuple
  returns 409.
- Callers sign `digest` directly (no EIP-191 prefix) — this is a
  programmatic signing path, not a wallet UX path.

### Deployment checklist

1. Apply `gateway/migrations/0003_l4c_signed_writes.sql` to
   `reckon402-d1-gateway-dev`.
2. Gateway `wrangler.toml [vars].RECKON402_ONBOARDING_EOA` — set to the
   public address of the onboarding signer.
3. `wrangler deploy --env production` on gateway (admin routes live).
4. Orchestrator wrangler secrets (Infisical-piped):
   `ETH_SEPOLIA_RPC_PRIMARY`, `BASE_SEPOLIA_RPC_PRIMARY`,
   `ENS_FUNDER_PK`, `RECKON402_DEPLOYER_PK`, `RECKON402_ONBOARDING_PK`.
5. Orchestrator `wrangler.toml [vars].SPLITTER_FACTORY_ADDRESS` +
   `.RECKON402_ONBOARDING_EOA` — fill post-08A deploy.
6. `wrangler deploy --env production` on onboard-orchestrator. Route
   binds to `app.reckon402.com`.
7. Smoke: `just onboard seller9.reckon402-test.eth 0x<sellerEoa>` runs
   end-to-end locally against live Sepolia + Base Sepolia.
8. Smoke: `just fullflow-l4c-onboard` runs the automated harness.
9. Push tag `L4c-onboarding-green`.

## L4d on-chain Escrow (v1, locked)

Shipped 2026-05-02. EscrowFactory + LinearMonotonicTierStrategy +
first probe Escrow live on Base Sepolia. Closes the on-chain story
for the risk-buffer slice of every settlement: the Splitter sends a
fixed BPS slice (10% in v1) to a per-agent Escrow, and the agent's
NFT owner withdraws subject to a **pluggable tier strategy** that
reads on-chain attestation count from the ReputationRegistry.

**Canonical reproducible tags:**
- `L4d-pre-onchain-baseline` (`8a468ec`) — pre-L4d state, demo intact;
  rollback target if L4d work needs to be unwound.
- `L4d-contracts-green` (`b2ab6ef`) — initial contracts (pre-pluggable)
  compiled + 46 tests green from a fresh clone, no live chain
  footprint at that point.
- `L4d-strategy-green` (`4a42c84`) — pluggable `ITierStrategy`
  refactor (Q-09-5 resolved in v1); 57 L4d tests / 106 full-suite
  tests green from a fresh clone.
- `L4d-strategy-deployed` (this section) — EscrowFactory +
  LinearMonotonicTierStrategy + probe Escrow live on Base Sepolia
  with the pluggable shape; sanity reads + non-owner revert smoke
  green.

### Contract addresses (Base Sepolia, canonical)

| Item | Value |
|------|-------|
| **EscrowFactory** | `0xb06998682bd716e0864257b3ac3aa1fc4cc64589` |
| Factory deploy tx | `0x248161a136d997dd82fa184bdceac5cb4c512ac2d253d9a70735d9170b692318` |
| Factory deploy block | 40971225 |
| Factory deploy gas | 1_750_822 |
| Factory deploy signer | `0x66c2858d9a8605957c516a77262eb66ee6be113c` (KMS `alias/reckon402/mainnet/deployer/evm`) |
| **LinearMonotonicTierStrategy (v1 default)** | `0xc498155bc4a2e4ba979ad5797298107c63b26c4e` |
| Strategy deploy tx | `0x43292eb658e3f062c6d59f44991775012b8d3349d9477b96db575414af8526fb` |
| Strategy deploy block | 40971225 |
| Strategy deploy gas | 601_592 |
| Strategy deploy signer | same KMS deployer as factory |
| **Probe Escrow (agentId=1)** | `0xEa8BEd2bEE679276F78DeCa49eE8B531f0ADaF78` |
| Probe Escrow tx | `0x280deaaa61df32f32a71c23e8b9f5f97646ea5557e6a034e991a1b885a63dffa` |
| Probe Escrow block | 40971241 |
| Probe Escrow signer | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` (`RECKON402_DEPLOYER_PK`; factory has no admin so anyone may call `createEscrow`) |
| Token (USDC, all Escrows) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| IdentityRegistry (8004) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry (8004) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

### Stale (superseded — do NOT use)

The first L4d deploy on 2026-05-02 used the old (pre-pluggable)
Escrow constructor shape. Those addresses are kept on-chain as
immutable evidence under the historical `L4d-deployed` tag but MUST
NOT be referenced by orchestrator (E2), frontend (E3), or any
upstream consumer:

| Item | Address | Status |
|------|---------|--------|
| EscrowFactory v1 (stale) | `0xb57ada3c2edffb5ce250b495d16d47e120d33d8b` | NOT USED |
| Probe Escrow v1 (stale) | `0x4f79aA82E7cf4e09Be9add4Df61887d270cFD95E` | NOT USED |

### v1 default tier curve (held in the strategy contract, NOT in Escrow)

```
thresholds = [0, 1, 3, 10, 30, 100, 300, 1000]
releaseBps = [0, 500, 1500, 3000, 5000, 7000, 8500, 10000]
tag1       = "payment"          (held in Escrow, per-agent)
tag2       = "x402-settlement"  (held in Escrow, per-agent)
facilitatorClient = 0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455
```

The strategy contract validates strict-monotonic thresholds and
non-decreasing releaseBps (each ≤ 10_000) at its own deploy time.
The Escrow trusts whatever `ITierStrategy` address is supplied at
construction. Different agents can be wired to different strategies;
strategies can be shared across many Escrows.

### Smoke results (probe Escrow, 2026-05-02)

| view                    | observed                                | meaning |
|-------------------------|------------------------------------------|---------|
| `owner()`               | `0x21fdEd74C901129977B8e28C2588595163E1e235` | Current IdentityRegistry NFT owner of agentId=1 |
| `agentId()`             | 1                                        | matches constructor |
| `facilitatorClient()`   | `0x0A0228E6...c455`                      | matches L4b1 facilitator EOA |
| `tierStrategy()`        | `0xc498155b...26c4e`                     | matches deployed v1 default strategy |
| `tag1()` / `tag2()`     | `"payment"` / `"x402-settlement"`        | matches constructor |
| `attestationCount()`    | 16                                       | live read of L4b1 attestations from ReputationRegistry on Base Sepolia |
| `releasedBps()`         | 3000 (= 30%)                             | T3 tier at 16 attestations — full delegation chain `Escrow → Strategy → ReputationRegistry` round-trips |
| `totalDeposited()`      | 0                                        | Escrow is brand-new; no settlements have flowed |
| `currentlyHeld()`       | 0                                        | matches |
| `totalWithdrawn`        | 0                                        | matches |
| Non-owner withdraw      | reverts `0x30cd7471` (`NotOwner()`)      | owner gate works on deployed bytecode |

### Files

- Spec: `specs/09-l4d-escrow.md`
- Deploy log: `contracts/deploy-logs/escrow-factory-base-sepolia-2026-05-02.md`
- Runbook: `tools/deploy/deploy-l4d.md`
- Deploy script (KMS-signed, Node + viem; deploys both contracts): `tools/deploy/deploy-escrow-factory.mjs`
- Local-test deploy script (Foundry, no KMS): `contracts/script/DeployEscrowFactory.s.sol`
- Contracts: `contracts/src/Escrow.sol`, `contracts/src/EscrowFactory.sol`,
  `contracts/src/LinearMonotonicTierStrategy.sol`,
  `contracts/src/interfaces/{IIdentityRegistry,IReputationRegistry,ITierStrategy}.sol`
- Tests: `contracts/test/Escrow.t.sol` (26 cases),
  `contracts/test/EscrowFactory.t.sol` (14 cases incl. 256-run fuzz),
  `contracts/test/LinearMonotonicTierStrategy.t.sol` (17 cases incl. 256-run fuzz)

### Forge: 106/106 from a fresh clone

49 pre-L4d (Splitter + invariant + SplitterFactory + SplitterFork +
Reckon402Resolver) + 57 L4d (26 Escrow + 14 EscrowFactory + 17
LinearMonotonicTierStrategy). Vitest: unchanged from
`L4c-onboarding-green` since L4d ships no worker code in this layer
(E2 onboarding integration is the next layer).

### Forward-compat / next layers

- **E2 (orchestrator)** — extend `tools/onboard/src/steps/` with a
  step-3.5 that deploys an Escrow at the predicted address before
  setting ENS records. New ENS record `x402.escrow`. Splitter
  recipients change from `[seller, facilitator-fee, facilitator-EOA-as-buffer]`
  to `[seller, facilitator-fee, predictedEscrowAddr]` once
  `ENABLE_L4D_ESCROW="true"` is set on the orchestrator. Orchestrator
  passes `tierStrategy=<v1 default>` for every onboarding in v1.
- **E3 (frontend)** — `window.ethereum` connect + NFT-owner gating +
  `Claim` button calls `Escrow.withdraw` via wallet directly. Three
  counters fed by `Escrow.getStats()` (one eth_call). Tier table
  rendered by querying `tierStrategy() → strategy.config()` (two
  eth_calls, both cacheable).
- **E4 (e2e)** — onboard `seller10.reckon402-test.eth` via the new
  flow. Fund some attestations through `full-flow-l4b.sh` to ramp
  the tier. MetaMask-import the seller PK, click Claim, verify
  on-chain. Tag `L4d-end-to-end-green`.

### Q-09-* dispositions

- **Q-09-5 (pluggable `ITierStrategy`):** RESOLVED in v1. The Escrow
  holds NO tier math; it delegates every `releasedBps()` read to a
  pinned `ITierStrategy` contract. v1 ships
  `LinearMonotonicTierStrategy` whose evaluation is byte-identical
  to the pre-refactor inline walk. Strategy address is part of the
  Escrow's CREATE2 init-code hash. Test
  `EscrowFactoryTest.test_createEscrow_distinctStrategies_deployIndependently`
  locks the invariant.
- **Q-09-6 (sybil floor — closed):** ReputationRegistry derives
  `clientAddress` from `msg.sender` at write time, NOT a parameter.
  Combined with the Escrow's `getSummary(agentId, [facilitatorClient],
  tag1, tag2)` filter, only the holder of the facilitator's private
  key can produce attestations the Escrow counts. Sybil cost = the
  cost of compromising the facilitator KMS key.
- **Q-09-7 (CCIP-Read off-chain ENS unreadable from contract — closed):**
  the Escrow does not and cannot read ENS text records served via
  CCIP-Read. All tier-relevant inputs come from on-chain registries
  (IdentityRegistry for owner, ReputationRegistry for count). ENS
  records are off-chain-only metadata served by the gateway worker.
  See `docs/trust-architecture.md` for the architecture rationale.

## L4d demo agent (seller11, canonical, locked)

Onboarded 2026-05-02 via the L4d 6-step CLI flow (`just onboard-l4d`).
This is the live demo target for the submission cycle. The legacy
seller (`seller.reckon402-test.eth` + Splitter `0x372c0b95…`) is
preserved on-chain but no longer fronted by `agent.reckon402.com`.

### On-chain locks

| Item | Value |
|------|-------|
| ENS subname | `seller11.reckon402-test.eth` |
| Seller EOA (NFT owner) | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` |
| ERC-8004 agentId | `5423` |
| Splitter (3-recipient, factory-deployed) | `0x9fc28c71a539645bECc6bEd26288a8e097AD17Eb` |
| Escrow (per-agent, factory-deployed) | `0x863d2105B57Cb98129B68b934FF5708DC9432aAA` |
| BPS split | seller `8700` (87%) / facilitator-fee `300` (3%) / escrow `1000` (10%) |
| Tier strategy | `0xc498155bc4a2e4ba979ad5797298107c63b26c4e` (LinearMonotonicTierStrategy v1) |
| Agent worker | `agent.reckon402.com` (re-pointed from seller → seller11; version `02492303-f3f4-4c46-9250-2168dd85e192`) |
| Onboarding orchestrator | `app.reckon402.com` (L4d 6-step flow live) |

The factory + strategy come from the L4d on-chain Escrow section above
(`L4d-strategy-deployed` tag). The Splitter + Escrow are seller-specific
artefacts of the onboarding run.

### Closed-loop end-to-end (5 rounds, 2026-05-02)

| Field | Value |
|-------|-------|
| Total settlements | 5 (each `0.01` USDC) |
| Total deposited to Escrow | `5000` atomic = `0.005000` USDC (10% of 0.05 USDC settled) |
| Attestations written | 5 (facilitator-signed; clientAddress = `0x0A0228…c455`) |
| Final tier | T2 (3 ≤ count < 10) |
| `releasedBps` after 5 rounds | `1500` (15%) |
| `withdrawableNow` after 5 rounds | `750` atomic = `0.000750` USDC |
| Gateway-side discount BEFORE | `100000` (base) |
| Gateway-side discount AFTER | `90000` (T2, 15% off) |
| Frontend dashboard | renders all 7 counters from `Escrow.getStats()` via raw `eth_call`; tier table highlights the active row |

Per-round artefacts in
`tools/integration-tests/results-full-flow-l4b-2026-05-02T09-{16-11,17-32,17-48,18-05,18-20}Z.md`.

Consolidated end-to-end report:
`tools/integration-tests/results-full-flow-l4d-seller11-2026-05-02.md`.

### Operator demo flow

1. `https://app.reckon402.com/#/agent/seller11.reckon402-test.eth`
   — dashboard view.
2. `Run Test Call` button (or `just fullflow-l4b` with
   `SELLER_NAME=seller11.reckon402-test.eth SELLER_ENS=seller11.reckon402-test.eth`)
   — drives one paid call + one attestation; counters update live.
3. `Connect Wallet` → import seller PK in MetaMask → Claim All button
   activates once the connected address matches
   `IdentityRegistry.ownerOf(5423) = 0xD53ffac4…7b1f`.
4. `Claim All` → MetaMask signs `Escrow.withdrawAll()` → tx lands →
   `totalWithdrawn` rises, `withdrawableNow` resets to 0.

### Forward-compat / next layers

- **E4-claim** still pending: MetaMask-import seller PK, click Claim
  All on the dashboard, verify `withdrawAll()` lands and
  `totalWithdrawn` updates. Tag `L4d-end-to-end-green`.
- **agent.reckon402.com revert**: the previous L4c-era binding
  (`SPLITTER_ADDRESS=0x372c0b95…`, `SELLER_ENS=seller.reckon402-test.eth`)
  is preserved as a comment in `workers/agent/wrangler.toml`. To roll
  back the live agent, restore the two var values and redeploy.

## Open questions

Track as Markdown files under `specs/open-questions/` (created lazily
on first need). Each open question gets a Q-XX identifier and a
disposition (resolved / deferred / blocking). When resolved, the
disposition is rolled back into the relevant spec and the open-question
file is closed (deleted in the same commit that lands the resolution).
