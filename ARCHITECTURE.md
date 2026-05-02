# Reckon402 — Architecture

Reckon402 closes the first loop in agent commerce. Every confirmed x402
payment writes an ERC-8004 reputation attestation, signed by the facilitator,
on-chain. Every subsequent ENS resolution reads that history back through
CCIP-Read and returns a **trust signal** — a verifiable count of past
settlements between the same parties. Downstream code can bind that signal
to any history-aware behavior: tier-adjusted price, risk-weighted routing,
optimistic-vs-strict service handling, investable-agent revenue claims.

---

## The closed loop

```
BuyingAgent ──── HTTP POST /research ────► Agent Worker (agent.reckon402.com)
                                                │
                                  402 Payment Required
                                                │
BuyingAgent ──── X-Payment header ──────► Agent Worker
                                                │
                                   forward to Facilitator
                                                │
                             ┌──────────────────▼──────────────────┐
                             │  Facilitator (facilitator.reckon402.com) │
                             │                                          │
                             │  1. resolve splitter via ENS gateway     │
                             │  2. transferWithAuthorization (USDC)      │
                             │  3. Splitter.distribute()                 │
                             │  4. giveFeedback() → ReputationRegistry  │
                             │  5. invalidate gateway cache              │
                             └───────┬──────────────────┬───────────────┘
                                     │ on-chain          │ on-chain
                              ┌──────▼──────┐    ┌──────▼──────┐
                              │  Splitter   │    │ ReputationR. │
                              │  (immutable)│    │  (ERC-8004)  │
                              └──┬────┬─────┘    └──────────────┘
                           87%  3%  10%                 │
                           │    │    └──► Escrow         │ attestation count
                           │    │        (NFT-bound)◄────┘
                           ▼    ▼         │
                        Seller  Fac       │ tier read
                        payout  fee       ▼
                                    TierStrategy
                                    (pluggable)
                                          │
                             ┌────────────▼──────────────┐
                             │  ENS Gateway (CCIP-Read)  │
                             │  gateway.reckon402.com     │
                             │  next call reads tier →   │
                             │  returns x402.amount=90000│
                             │  (T2 seller: 10% off)     │
                             └───────────────────────────┘
```

---

## Per-agent components

### Splitter (immutable, BPS-locked)

Deployed via `SplitterFactory` (CREATE2, `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7`).
Three recipient slots, locked at deploy time:

| Slot | Recipient | BPS (demo) |
|------|-----------|-----------|
| 0 | Seller EOA | 8700 (87%) |
| 1 | Facilitator fee | 300 (3%) |
| 2 | Per-agent Escrow | 1000 (10%) |

`distribute()` is permissionless — anyone can call it. No external reads at
distribution time; the Splitter is a clean immutable primitive. Direct payout
slots (0 and 1) forward funds immediately and are not NFT-bound. The Escrow
slot holds funds and is NFT-bound (see below).

### Escrow (NFT-bound trust ramp)

Deployed via `EscrowFactory` (`0xb06998682bd716e0864257b3ac3aa1fc4cc64589`).
Each SellingAgent gets one Escrow, keyed by `agentId`.

- `withdrawAll()` gates on `IdentityRegistry.ownerOf(agentId) == msg.sender`,
  so accumulated funds follow the agent's NFT around an ownership transfer.
- `attestationCount()` reads `ReputationRegistry.getSummary(agentId,
  [facilitatorClient], "payment", "x402-settlement").count` via a single
  `STATICCALL`. Only attestations whose `msg.sender` was the pinned
  `facilitatorClient` EOA (`0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`) count.
  Sybil cost = cost of compromising that KMS-resident key.
- `releasedBps()` delegates to the pinned `ITierStrategy` contract.

### TierStrategy (pluggable curve)

`LinearMonotonicTierStrategy` v1 (`0xc498155bc4a2e4ba979ad5797298107c63b26c4e`):

| Tier | Min attestations | Release BPS |
|------|-----------------|-------------|
| T0 | 0 | 0 |
| T1 | 1 | 500 (5%) |
| T2 | 3 | 1500 (15%) |
| T3 | 10 | 3000 (30%) |
| T4 | 30 | 5000 (50%) |
| T5 | 100 | 7000 (70%) |
| T6 | 300 | 8500 (85%) |
| T7 | 1000 | 10000 (100%) |

Constructor validates strict-monotonic thresholds and non-decreasing BPS.
Different agents can be wired to different strategies; strategies are shared
across Escrows. The v1 curve is held in the strategy contract, not in the
Escrow — swapping curves for an agent is a new Escrow deploy pointing at a
different strategy address.

---

## ENS record ACL split

Records for `*.reckon402-test.eth` are served off-chain by
`gateway.reckon402.com` via CCIP-Read (ERC-3668) and backed by D1. Two
signing classes enforce separate write authority:

| Key | Writer | Rationale |
|-----|--------|-----------|
| `x402.splitter` | Reckon402 | Factory-deployed address; Reckon402 sets it at onboarding |
| `x402.facilitator` | Reckon402 | Platform routing; SellingAgent cannot redirect payments |
| `x402.erc8004.registry` | Reckon402 | Registry addresses are protocol-level |
| `x402.erc8004.agent_id` | Reckon402 | agentId minted on the identity contract by Reckon402 |
| `x402.amount` | SellingAgent | SellingAgent sets their own price |
| `x402.pricing` | SellingAgent | Tier-pricing strategy hint (L4c legacy parallel layer) |
| `x402.endpoint` | SellingAgent | SellingAgent controls their service endpoint |
| `x402.attestation` | SellingAgent | Optional per-merchant write opt-in |
| `x402.yield` | SellingAgent | Revenue-share config |
| `x402.scheme` / `.version` / `.asset` | SellingAgent | Payment asset preference |

Bootstrap window: while `ENSRegistry.owner(namehash(ensName))` equals
`RECKON402_ONBOARDING_EOA`, Reckon402 may also write SellingAgent-class keys.
The final step of onboarding calls `setOwner(subnode, sellerEoa)` which closes
this window permanently. After transfer, Reckon402 `/admin/records` calls for
SellingAgent keys return 403.

CCIP-Read records are not readable from a smart contract (ERC-3668 requires an
off-chain fetch loop the EVM cannot execute). All security-critical contract
inputs come from on-chain registries: IdentityRegistry for owner, Reputation-
Registry for attestation count, SplitterFactory for splitter validation.

---

## Trust mechanism: seller11 worked example

Live demo agent `seller11.reckon402-test.eth`, agentId `5423`,
Escrow `0x863d2105B57Cb98129B68b934FF5708DC9432aAA`.

After 5 settlements of 0.01 USDC each:

| Metric | Value |
|--------|-------|
| Total deposited to Escrow | 5 000 atomic (0.005000 USDC) — 10% of 0.050000 USDC settled |
| Attestations written | 5 (facilitator-signed; clientAddress = `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`) |
| Tier reached | T2 (3 ≤ count < 10) |
| `releasedBps` | 1500 (15%) |
| `withdrawableNow` | 750 atomic (0.000750 USDC) = 5 000 × 0.15 |
| Gateway price before | `x402.amount = 100000` (base) |
| Gateway price after | `x402.amount = 90000` (T2, 10% off) |

The claim tx (`withdrawAll()` calldata `0x853828b6`) transferred 750 atomic
from Escrow to seller. Post-claim `Escrow.getStats()`:
`(totalDeposited=5000, currentlyHeld=4250, totalWithdrawn=750,
withdrawableNow=0, releasableNow=0, attestationCount=5, releasedBps=1500)`.

Invariants verified on-chain:
- `currentlyHeld + totalWithdrawn = totalDeposited` → 4250 + 750 = 5000
- `withdrawableNow = max(0, releasedAmount − totalWithdrawn)` → 0 = 750 − 750
- `releasedAmount ≤ releasedBps × totalDeposited / 10_000` → 750 ≤ 750

Claim tx: `0x5c92bb439abe5d2a831f4b279997bbf383aff93d9ade376d3d15c95aaa2c820a`

The remaining 4 250 atomic accumulates in the Escrow and becomes withdrawable
as the attestation count walks T2 → T3 (10 attestations) → T4 → ...

---

## To be built

**To be built after.** Buyer-side proof-of-non-delivery (zkTLS via Reclaim
Protocol on the buyer SDK) that triggers a negative attestation and unlocks
Escrow withdrawal back to the buyer. Other history-aware adaptations — pure
tier pricing, risk-weighted routing, optimistic-vs-strict handling,
investable-agent revenue claims — drop in directly; they're consumer-side,
not protocol-side. The orthogonal problem space (privacy + batching +
sub-cent economics) belongs to a different solution vector and is out of
scope for Reckon402.
