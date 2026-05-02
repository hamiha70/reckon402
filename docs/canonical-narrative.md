# Reckon402 — Canonical Narrative (locked H-9)

> **Status:** LOCKED 2026-05-02 ~16:10 CET. Single source of truth for every
> public-facing surface (landing page, submission draft, README,
> ARCHITECTURE.md, demo dashboard, video script).
>
> **Editing rule.** This file is the canonical source. Subagent prompts MUST
> cite this file. If a subagent feels the wording needs to change, it stops
> and reports back; it does not paraphrase the locked block in its target
> file. Drift between this file and any deployed surface is a bug.

---

## Tagline

**Hero:** Agent commerce with memory.

**Sub:** Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads
it back. The trust signal drives history-aware behavior — for this hackathon,
a per-agent on-chain Escrow that holds funds against future claims and
releases as on-chain reputation grows.

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

## Style guide for downstream surfaces

- **No marketing language.** Avoid "revolutionary", "game-changing",
  "groundbreaking", "transforms". Use plain technical English. The story is
  strong; superlatives weaken it.
- **No emojis.**
- **Numbers and addresses are concrete.** Cite live tx hashes, addresses,
  and tier-curve values verbatim from `AGENTS.md` § "L4d on-chain Escrow",
  not from this narrative file. This file is for prose; live evidence
  lives in `AGENTS.md` and `docs/test-posture-h-9.md`.
- **Two solution vectors framing is load-bearing.** Whenever the broader
  agent-commerce problem space is mentioned, the vector A / vector B split
  must be present. Naming nanocrawl or any specific competitor is
  prohibited — the framing stays abstract.
- **"Trust signal" not "trust score".** A score implies a single number
  and a ranking; a signal implies a verifiable input that downstream code
  consumes. Reckon402 produces a signal; consumers compute scores.
- **"History-aware behavior" not "use cases".** The point is that
  reputation-conditioned logic is a category, not a list of features.

---

## Cross-references

- AGENTS.md — canonical operational + on-chain state
- docs/trust-architecture.md — three sharp questions (Sybil, ERC-8004 bypass,
  on-chain ENS reads), pluggable tier strategy, NFT-binding asymmetry
- docs/test-posture-h-9.md — full test inventory + healthz + fork tests
- docs/demo-design.md — 3-minute demo flow narrative (PRE-A0 LOCK; needs
  reconciliation with this file as part of the parent's Lane A pass)
- specs/09-l4d-escrow.md — Escrow contract spec
- specs/06-actor-act-matrix.md — DXa/DXb framing for who-signs-what
