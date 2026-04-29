# specs/

Implementation contracts for Reckon402.

Each spec lands in its own commit, before the code that implements it.
This is a deliberate cadence choice — see `../AGENTS.md` for rationale.

Specs are technical contracts: ABI fragments, TS types, schemas, state
machines, test plans. Strategic positioning, marketing copy, and
decision-rationale belong in `../README.md` or commit messages, not in
specs.

Each spec has a stable filename matching the build-layer or component
it implements:

- `00-l0-smoke-tests.md` — L0 infra + sponsor-tech checklist
- `01-eoa-topology.md` — EOA roles, custody, and funding plan
- `02-kms-signer.md` — viem `LocalAccount` adapter over AWS KMS
- `03-l1-agent-stub.md` — bare seller agent on `agent.reckon402.com`
- `04-l2-x402-baseline.md` — canonical x402 v2 paywall via CDP
- `05-types-and-sdk.md` — `@reckon402/types` + buyer SDK API surface
- `06-splitter.md` — Splitter contract (Foundry)
- `07-facilitator.md` — Facilitator worker (CFW + D1)
- `08-x35-state-machine.md` — Reconciliation + idempotency
- `09-gateway.md` — CCIP-Read gateway (ENS Track 1 + 2)
- `10-erc8004-closed-loop.md` — Treasury-Deposit reputation writes
- `11-signing-wrapper.md` — AWS Lambda KMS signer (re-exports `02-kms-signer`)
- `12-kh-skill-and-recipes.md` — KeeperHub workflow + reproducibility

The numbering is intentionally sparse to allow late-arriving
mid-sequence specs (e.g. an unforeseen middleware contract) to slot
in without renumbering downstream files.

Cross-cutting specs (not tied to a single layer):

- `06-actor-act-matrix.md` — actor / act / signer / broadcaster /
  gas-payer matrix. Any new layer that adds an on-chain or
  off-chain act cross-checks against this doc before implementing.
