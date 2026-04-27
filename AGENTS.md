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
| KMS alias                  | `alias/reckon402/mainnet/buyer-signer/evm`                                     |
| IAM user for signer        | `reckon402-signer`                                                             |
| Cloudflare resource prefix | `reckon402-*` (e.g., `reckon402-facilitator-prod`, `reckon402-d1-facilitator`) |
| Settlement chain (demo)    | Base Sepolia for L3 dev; Base mainnet for L4 / submission                      |

## Persistence model (v1)

Single-tier **D1-only** for all worker state. Per-paymentId idempotency
guaranteed by SQLite UNIQUE constraint + `INSERT OR IGNORE`. Forward-
compat path to multi-tier (KV + DO-SQLite + relational) after hackathon.

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
