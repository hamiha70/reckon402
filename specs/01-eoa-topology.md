# Spec 01 — EOA topology + funding plan

Status: implementation contract.
Owner: `tools/provision-eoas.mjs`, `tools/fund-downstream.mjs` (TBD).

## Purpose

Define the on-chain EOA roles, custody model, and funding plan for the
reckon402 demo across Base Sepolia (L3 dev) and Base mainnet (L4 /
submission).

## Design constraints (operator-locked)

- **Same EOA per role on both chains.** EVM addresses are derived from
  the secp256k1 keypair; reusing the same key on Sepolia + Mainnet is
  free and avoids per-chain key sprawl. KMS keys are inherently
  chain-agnostic.
- **Single KMS-backed deployer funds every other address.** No address
  is funded directly from the operator's main wallet except the
  deployer itself.
- **Buyer-signer in KMS** for the production-grade signing path
  (L4 Lambda → KMS sign).
- **Software wallets acceptable** for the facilitator, seller, and
  demo buyer agents. Their private keys live in Infisical
  (`reckon402/dev`), gitignored.
- **Real USDC on mainnet** (funded from operator's main wallet, on
  the day before submission).
  **Faucet USDC on Sepolia** (Circle's `faucet.circle.com`) for L3.

## Roles + custody

| # | Role | Custody | Identifier | Funded with | First-funder |
|---|------|---------|------------|-------------|--------------|
| 1 | **Deployer** | KMS (NEW) | `alias/reckon402/mainnet/deployer/evm` | ETH | Operator main wallet |
| 2 | **Buyer-signer** (L4 demo, "real" buyer) | KMS (existing) | `alias/reckon402/mainnet/buyer-signer/evm`; EOA `0x46bb...4305` | USDC | Deployer |
| 3 | **Facilitator** | Software (PK in Infisical) | generated; key `FACILITATOR_PK` / `FACILITATOR_ADDRESS` | ETH (gas only — settle txs) | Deployer |
| 4 | **Seller** (demo merchant) | Software (PK in Infisical) | generated; key `SELLER_PK` / `SELLER_ADDRESS` | nothing (just receives) | n/a |
| 5–7 | **Buyer demo agents** ×3 (L3 SDK demo, concurrent-buyer flow) | Software (PKs in Infisical) | generated; keys `BUYER_DEMO_{1,2,3}_PK` / `BUYER_DEMO_{1,2,3}_ADDRESS` | USDC (small) | Deployer |

Total: **2 KMS-backed addresses + 5 software wallets = 7 reckon402 EOAs.**

## Naming conventions

KMS aliases follow the project-level convention from
`~/Projects/aws_setup_2026/docs/x402commit-kms.md`:

```
alias/reckon402/mainnet/{role}/evm
```

The "mainnet" tier-word is a money-tier classification (this key
holds real value), not a chain restriction. The same key is used on
Sepolia transactions; Sepolia is just "real money tier on a test
network".

| Resource | Pattern | Example |
|----------|---------|---------|
| KMS alias | `alias/reckon402/mainnet/{role}/evm` | `alias/reckon402/mainnet/deployer/evm` |
| IAM user | `reckon402-{role}` (short form, matches AGENTS.md lock for buyer-signer) | `reckon402-deployer` |
| IAM policy | `reckon402-mainnet-{role}-kms-policy` | `reckon402-mainnet-deployer-kms-policy` |
| Infisical PK key | `{ROLE}_PK` (uppercase, role only) | `FACILITATOR_PK` |
| Infisical address key | `{ROLE}_ADDRESS` | `FACILITATOR_ADDRESS` |

## Funding flow (target)

```
operator main wallet (mainnet)
      │
      └─ ~0.005 ETH + ~$5 USDC ──► Deployer (KMS)
                                          │
                                          ├─ ~0.001 ETH ──► Facilitator
                                          ├─ ~$2 USDC  ──► Buyer-signer (KMS)
                                          └─ ~$1 USDC each ──► Buyer demo ×3
                                            (~$3 total)

Sepolia:
operator → Base Sepolia ETH faucet ──► Deployer (~0.05 ETH)
operator → Circle USDC faucet      ──► Deployer (~$10)
[same intra-deployer fan-out, faucet-amounts]
```

The seller receives but never sends; no funding required.

## Custody risk model

Critical principle: a software-key leak limits losses to that role's
balance.

| Role | Custody risk | Max-loss bound |
|------|--------------|----------------|
| Deployer | KMS (HSM, non-exfiltrable) | catastrophic if KMS policy compromised; `kms:Sign` only on key ARN |
| Buyer-signer | KMS (HSM, non-exfiltrable) | same — buyer's USDC, but capped at funded amount |
| Facilitator | Software (Infisical) | ETH balance only (gas wallet) |
| Seller | Software (Infisical) | accumulated USDC payments; rotate before submission if over $5 |
| Buyer demo ×3 | Software (Infisical) | $1–2 USDC each; trivial if leaked |

Software keys are rotatable by regenerating, pushing new values to
Infisical, and re-funding from the deployer. The provisioning script
(`tools/provision-eoas.mjs`) is idempotent: it skips a role if its
PK is already set in Infisical.

## Provisioning order

1. **Spec** (this commit).
2. **KMS deployer** — `aws kms create-key` + `create-alias` +
   IAM user + scoped policy + access keys + push to Infisical;
   cross-repo append to `aws_setup_2026/docs/x402commit-kms.md`.
3. **Software wallets** — `tools/provision-eoas.mjs` generates the
   five software keys via `viem`'s `generatePrivateKey`, derives
   addresses, pushes PK + ADDRESS pairs to Infisical (per role)
   only when not already set. Commit the script; commit a
   verification log listing the addresses (no PKs) after running.
4. **AGENTS.md update** — extend the locks table to enumerate all
   seven EOAs and their custody scheme.
5. **Funding** — deferred. Sepolia funding is operator-on-faucets;
   mainnet funding is operator-from-main-wallet.

## Open questions

- **Q-01-1.** Number of demo buyer agents. Spec proposes 3; tighten
  during L3 build if concurrency demo requires more or fewer.
- **Q-01-2.** Seller shape. The L3+ architecture has the Splitter
  contract as the on-chain receiver; the "seller EOA" listed here is
  the Splitter's output beneficiary (the merchant agent). Confirm
  that's the right semantic during the Splitter contract spec
  (forthcoming spec 02).
- **Q-01-3.** Funding amounts. Listed values are conservative
  starting points; refine when Splitter gas usage is benchmarked
  during L3 (`forge test --gas-report`).
- **Q-01-4.** Should the facilitator key migrate to KMS for L4?
  L4 production-shape architecture has the buyer signing via KMS
  (signing wrapper Lambda) — by symmetry, facilitator settle calls
  could also go through a KMS-backed key. Defer until L4 design
  lands; software key is sufficient through L3.
