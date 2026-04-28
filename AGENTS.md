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

## L4a deployments (v1, locked)

Deployed 2026-04-28. All gates passed. Tag: `L4a1-gateway-static-green` (pending push).

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
- Forge: 39/39 green (24 Splitter + 15 Resolver)

Tag: `L4a1-gateway-static-green` (pending Gate C push).

## Open questions

Track as Markdown files under `specs/open-questions/` (created lazily
on first need). Each open question gets a Q-XX identifier and a
disposition (resolved / deferred / blocking). When resolved, the
disposition is rolled back into the relevant spec and the open-question
file is closed (deleted in the same commit that lands the resolution).
