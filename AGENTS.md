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

## Open questions

Track as Markdown files under `specs/open-questions/` (created lazily
on first need). Each open question gets a Q-XX identifier and a
disposition (resolved / deferred / blocking). When resolved, the
disposition is rolled back into the relevant spec and the open-question
file is closed (deleted in the same commit that lands the resolution).
