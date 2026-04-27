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
- `01-l1-agent-stub.md` — bare seller agent on `agent.reckon402.com`
- `02-l2-x402-baseline.md` — canonical x402 v2 paywall via CDP
- `03-types-and-sdk.md` — `@reckon402/types` + buyer SDK API surface
- `04-splitter.md` — Splitter contract (Foundry)
- `05-facilitator.md` — Facilitator worker (CFW + D1)
- `06-x35-state-machine.md` — Reconciliation + idempotency
- `07-gateway.md` — CCIP-Read gateway (ENS Track 1 + 2)
- `08-erc8004-closed-loop.md` — Treasury-Deposit reputation writes
- `09-signing-wrapper.md` — AWS Lambda KMS signer
- `10-kh-skill-and-recipes.md` — KeeperHub workflow + reproducibility
