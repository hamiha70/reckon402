# Reckon402

**Agent commerce with memory.**

ETHGlobal OpenAgents 2026 submission. A closed-loop x402 reputation
engine: settlement-side ERC-8004 attestation writes wired into
ENS-resolved x402 routing, paired with adoption surfaces (buyer SDK,
middleware, KH skill, signing wrapper).

## Status

Scaffolding. Build cadence H-4 → H-9 (Mon Apr 27 → Sat May 02).

## Operator dependencies

Local CLIs the operator workstation needs before driving any of the
layered builds. All of these are CLI-only setups; no console clicks
required for routine work (per the CLI-first lock in
[`AGENTS.md`](./AGENTS.md)).

| Tool       | Purpose                                       | Auth                                                                 |
| ---------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm`     | Workspace package manager (Node 22 LTS)       | n/a — local only                                                     |
| `aws`      | AWS account ops (KMS, IAM, Lambda)            | `~/.aws/credentials` profile `intentra` (admin) + scoped IAM users   |
| `wrangler` | Cloudflare Workers / D1 / DNS deploys         | OAuth session (`wrangler login`) or `CLOUDFLARE_API_TOKEN` env       |
| `infisical`| Self-hosted secret hydration                  | `infisical login --domain https://secrets.intentralabs.com`          |
| `forge` / `cast` | Solidity compile + script (Foundry)     | n/a — wallet via KMS at script time                                  |
| `kh`       | KeeperHub workflow CLI (L4 driver)            | `kh auth login` — device-code OAuth (browser)                        |

### KeeperHub CLI (`kh`)

The `kh` CLI drives the L4 demo: workflow runs are launched from the
operator workstation and from the L4 KH-skill package. Setup follows
the canonical KH docs at <https://docs.keeperhub.com/cli>:

```bash
# Install (Homebrew tap)
brew install keeperhub/tap/kh

# Or, alternatively:
go install github.com/keeperhub/cli/cmd/kh@latest

# Authenticate (opens browser; token cached in OS keyring)
kh auth login

# Verify
kh auth status
```

For CI/CD or unattended use, set `KH_API_KEY` from a token created in
the KH web UI; the CLI prefers `KH_API_KEY` over the keyring token.

KeeperHub's wallet model is **non-custodial Turnkey**: the wallet
provisioned for your KH organisation lives in a Turnkey hardware
enclave (TEE) and signs workflow transactions directly. Private keys
never touch KeeperHub infrastructure during normal operation, and
they are exportable from the KH UI if you ever need to migrate. For
the reckon402 demo, the L4 architecture signs x402 PaymentAuthorizations
through the AWS-KMS-backed signing wrapper Lambda, not through the
KH wallet directly — see [`specs/01-eoa-topology.md`](./specs/01-eoa-topology.md)
for the full identity layout.

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
