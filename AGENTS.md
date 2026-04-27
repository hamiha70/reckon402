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
