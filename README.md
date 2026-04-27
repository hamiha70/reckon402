# Reckon402

**Agent commerce with memory.**

ETHGlobal OpenAgents 2026 submission. A closed-loop x402 reputation
engine: settlement-side ERC-8004 attestation writes wired into
ENS-resolved x402 routing, paired with adoption surfaces (buyer SDK,
middleware, KH skill, signing wrapper).

## Status

Scaffolding. Build cadence H-4 → H-9 (Mon Apr 27 → Sat May 02).

## Quickstart

To be populated during the build window. Scaffold lands first;
spec-driven layers follow per [`AGENTS.md`](./AGENTS.md).

## Layout

- `specs/` — implementation contracts (one `.md` per layer/component)
- `packages/` — pnpm workspaces (`@reckon402/types`, `@reckon402/buyer-sdk`, ...)
- `workers/` — Cloudflare Workers (agent, facilitator, gateway, treasury-deposit)
- `lambda/signing/` — AWS Lambda signing wrapper
- `contracts/` — Foundry project (Splitter)
- `recipes/` — reproducibility scripts (curl, viem, python, KeeperHub workflow)
- `demo/` — Vercel frontend
- `tools/` — build/deploy/smoke-test scripts

## License

MIT.
