# Reckon402

**Agent commerce with memory.**

Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads
it back. The trust signal drives history-aware behavior — for this hackathon,
a per-agent on-chain Escrow that holds funds against future claims and
releases as on-chain reputation grows.

---

## Status

109/109 Foundry + 362/362 Vitest (3 live-RPC skipped offline) + 15/15 healthz
probes green across 6 Workers, 1 Lambda, and 7 on-chain contracts (`just healthz-all`).

---

## Problem

Agent commerce isn't ready for prime time. The individual standards exist —
x402 negotiates payment in HTTP, ENS gives agents names, ERC-8004 tracks
identity and reputation on-chain, USDC settles. None of them close the loop,
so two sets of open problems pile up. **The first is trust:** a buying agent
paying a seller it has never met has no verifiable on-chain history to read,
no escrow to hold against bad delivery, no path to revoke a payment, no
mechanism to price-adjust by counterparty, no primitive for investable agents
or optimistic service handling. **The second is privacy and economics:** every
payment is a public datapoint, and per-call gas overhead breaks sub-cent
pricing. Both sets need new primitives. Reckon402 builds the first.

---

## Solution

Reckon402 closes that first loop. Every confirmed x402 payment writes an
ERC-8004 reputation attestation, signed by the facilitator, on-chain. Every
subsequent ENS resolution reads that history back through CCIP-Read and
returns a **trust signal** — a verifiable count of past settlements between
the same parties. Downstream code can bind that signal to any history-aware
behavior: tier-adjusted price, risk-weighted routing, optimistic-vs-strict
service handling, investable-agent revenue claims.

For this hackathon we pick the single most consistently underbuilt behavior:
**claims and revocation after settlement**. A portion of every payment flows
into a per-agent on-chain Escrow. The Escrow's release schedule is
parameterized by the same trust signal: low reputation → small fraction
released, large buffer held against future claims; high reputation → most of
the payment flows through immediately. Funds release as on-chain reputation
grows, NFT-bound to the agent's IdentityRegistry token so the buffer
transfers with ownership.

---

## Live URLs

| Surface | URL |
|---------|-----|
| Agent worker (SellingAgent) | `https://agent.reckon402.com` |
| Facilitator | `https://facilitator.reckon402.com` |
| CCIP-Read gateway | `https://gateway.reckon402.com` |
| Signing wrapper (AWS Lambda) | `https://signing.reckon402.com` |
| Onboarding app | `https://app.reckon402.com` |
| Landing / docs | `https://reckon402.com` |

---

## On-chain addresses

**Base Sepolia**

| Contract | Address |
|----------|---------|
| SplitterFactory v1 | `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7` |
| EscrowFactory v1 | `0xb06998682bd716e0864257b3ac3aa1fc4cc64589` |
| LinearMonotonicTierStrategy v1 | `0xc498155bc4a2e4ba979ad5797298107c63b26c4e` |
| seller11 Splitter (demo agent) | `0x9fc28c71a539645bECc6bEd26288a8e097AD17Eb` |
| seller11 Escrow (demo agent) | `0x863d2105B57Cb98129B68b934FF5708DC9432aAA` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

**Ethereum Sepolia**

| Contract | Address |
|----------|---------|
| Reckon402Resolver | `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` |

Demo agent: `seller11.reckon402-test.eth` — ERC-8004 agentId `5423`,
BPS split seller `8700` (87%) / facilitator-fee `300` (3%) / escrow `1000` (10%).

First live attestation tx:
`0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2`
(https://sepolia.basescan.org/tx/0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2)

EscrowFactory deploy tx:
`0x248161a136d997dd82fa184bdceac5cb4c512ac2d253d9a70735d9170b692318`

SplitterFactory deploy tx:
`0x2d77e747000edceed7d63d6ce19f890c0ca676eadd3cc8e12e7dd721e323134c`

---

## Quickstart

```bash
just preflight-submission   # pre-flight all infra + secrets gates
just healthz-all            # 15-probe sweep: Workers + Lambda + on-chain
just fullflow-l4b           # live settlement + attestation round-trip
```

---

## Repo structure

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

---

## Built / To be built

**Built in this hackathon.** Facilitator-signed ERC-8004 attestations on
every settlement; CCIP-Read ENS gateway returning the trust count; per-agent
SplitterFactory + Escrow with a pluggable, parameterized tier curve;
NFT-bound withdraw; fork-tested against live ERC-8004 contracts on Base
Sepolia.

**To be built after.** Buyer-side proof-of-non-delivery (zkTLS via Reclaim
Protocol on the buyer SDK) that triggers a negative attestation and unlocks
Escrow withdrawal back to the buyer. Other history-aware adaptations — pure
tier pricing, risk-weighted routing, optimistic-vs-strict handling,
investable-agent revenue claims — drop in directly; they're consumer-side,
not protocol-side. The orthogonal problem space (privacy + batching +
sub-cent economics) belongs to a different solution vector and is out of
scope for Reckon402.

---

## License

MIT
