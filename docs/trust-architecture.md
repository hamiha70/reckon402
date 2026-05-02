# Reckon402 trust architecture

Status: written 2026-05-02 alongside the L4d on-chain Escrow ship.
Section 4 added 2026-05-02 (post-deployment review on
`L4d-end-to-end-green`) to record why the Splitter's direct recipient
slots are NOT NFT-bound, only the Escrow is. This document captures
the structural questions raised at the Q-09-* gate and pins their
dispositions. It is intended for judges and implementers who need to
understand WHY the Reckon402 trust signals look the way they do — not
just WHAT they are.

The four questions:

1. **Sybil / spam mitigation** — how does the Escrow ignore attestations
   that aren't from a genuine settlement?
2. **ERC-8004 vs bypass** — why read attestation counts FROM the
   ReputationRegistry instead of just incrementing them inside the
   Escrow itself?
3. **Contract-readable ENS records** — can a contract read the
   `x402.*` text records served by the gateway? How are those records
   authenticated against forgery?
4. **Asymmetric NFT-binding** — why does the per-agent Escrow gate
   withdrawals on `IdentityRegistry.ownerOf(agentId)`, while the
   direct seller / facilitator-fee slots in the Splitter do NOT?

---

## 1. Sybil / spam mitigation on ERC-8004

The L4d Escrow gates withdrawal on a tier curve evaluated against
`ReputationRegistry.getSummary(agentId, [facilitatorClient], tag1,
tag2).count`. If anyone could write into that count, the entire
risk-buffer release schedule would be sybil-attackable: an attacker
mints a junk-attestation campaign, the Escrow reports a high tier,
the agent's NFT owner claims funds early.

**This attack surface is closed by design at the ERC-8004 level**,
not at the Escrow level. The chain is:

```
ReputationRegistry.giveFeedback(
    agentId,
    value, valueDecimals,
    tag1, tag2,
    endpoint, feedbackURI, feedbackHash
)
```

The crucial property: **`clientAddress` is derived from `msg.sender`
at the contract level — it is NOT a function argument**. There is no
way for a third party to write a `NewFeedback` event whose
`clientAddress` field reports another EOA. The on-chain check is
implicit in `msg.sender` semantics: the EVM literally cannot lie
about who broadcast the call.

The Escrow's `attestationCount()` reads:

```solidity
ReputationRegistry.getSummary(
    agentId,
    [facilitatorClient],   // the SINGLE EOA whose feedback we count
    "payment",
    "x402-settlement"
)
```

Therefore, only attestations whose `msg.sender` was
`facilitatorClient` AND whose tags match `("payment",
"x402-settlement")` count toward the Escrow's tier. Sybil cost
collapses to: **acquiring the facilitator's private key**. That key
is KMS-resident (`alias/reckon402/mainnet/buyer-signer/evm`) — the
same key whose public address `0x0A0228…c455` is hardcoded into the
deployed Escrow as `facilitatorClient`. The cost of sybil-attacking
the Reckon402 reputation system equals the cost of compromising
AWS KMS.

A separate concern is **third parties spamming `giveFeedback` with
their own `msg.sender`**. They can do this — anyone can write
attestations against any agentId — but those attestations carry
`clientAddress = <attacker EOA>`, NOT `0x0A0228…c455`. The
Escrow's `getSummary` filter rejects them at read time. The
ReputationRegistry's storage may bloat with attacker rows; the
Escrow's tier evaluation is unaffected.

**Net:** the Escrow's tier signal is sybil-resistant exactly insofar
as the facilitator key is non-extractable. We did NOT need to add
counter manipulation guards inside the Escrow itself. The ERC-8004
`msg.sender`-based authentication is doing the load-bearing work.

### Does this make ERC-8004 redundant?

It would be tempting to argue: "if we trust the facilitator key
already, why not just have the Escrow keep its own counter and let
the facilitator EOA call `Escrow.recordAttestation()`?" That reduces
gas and removes one cross-contract read.

We chose against this for two reasons:

1. **Composability with the broader ERC-8004 ecosystem**. Other
   reputation consumers (search agents, indexers, orchestrators,
   future versions of Reckon402 itself) want to read these signals
   too. Writing into ReputationRegistry makes the data discoverable
   without those consumers having to know about every Escrow
   contract individually.

2. **Aggregation of multiple facilitators in v1.5+**. The current
   Escrow filters on a single facilitatorClient. A future Escrow
   variant could pass a multi-element `clientAddresses` array and
   weight feedback from many facilitators. That's an additive
   change to the Escrow's `attestationCount()` body; the
   ReputationRegistry already supports it natively. If the count
   lived inside the Escrow, we'd be reinventing reputation
   aggregation in our own contract.

The Reckon402 facilitator contributes attestations to the public
ReputationRegistry; the Escrow then privately interprets a subset of
those attestations as its tier signal. This is a clean separation
of concerns: ReputationRegistry owns "what is true about this
agent in the public record"; the Escrow owns "what does this
specific risk-buffer policy reward".

---

## 2. Why the Escrow reads ERC-8004 instead of maintaining its own count

A natural question: the Escrow could keep `mapping(uint256 =>
uint64) public attestationCount;` and the facilitator could
`escrow.recordAttestation()` after every settlement. Why an
external read?

Three reasons, in order of weight:

1. **Single source of truth.** With the ERC-8004 read path, the
   number that drives the tier ramp is the SAME number that
   appears on Etherscan, in the gateway's reputation cache, in the
   future Reckon402 dashboard, and in any third-party reputation
   indexer that watches `NewFeedback` events. There is no scenario
   where the Escrow reports tier T3 while a separate consumer
   reports T2 because the off-chain logs disagreed about whether a
   particular settlement counted.

2. **Permissionless verification.** Anyone can independently audit
   the Escrow's tier claim by calling
   `ReputationRegistry.getSummary` themselves. They get the exact
   bytes the Escrow saw. If the Escrow held its own counter, an
   auditor would have to trust that the off-chain integration that
   incremented the counter was running correctly. ERC-8004 + a
   pinned `(facilitatorClient, tag1, tag2)` filter makes the audit
   path identical for the Escrow's own caller and any external
   observer.

3. **Migration path.** If we later want to deploy a v2 Escrow with
   a different release curve but the same agent's reputation
   history, we just point it at the same ReputationRegistry and
   the same `(facilitatorClient, tag1, tag2)` triple. No data
   migration, no replay of historical feedback events, no off-chain
   reconciliation. The Escrow is a thin pricing layer over a
   shared reputation truth.

The cost is one cross-contract `STATICCALL` per `releasedBps()` read
(~3 000 gas added). That's ~$0.001 per dashboard fetch at Base
mainnet gas levels — well below the threshold where we'd
re-evaluate.

---

## 3. Can a contract read ENS text records?

Short answer: **only if the records are stored on-chain at a
pre-pinned ENSResolver**. CCIP-Read records — like the `x402.*`
records served by `gateway.reckon402.com` for the `*.reckon402-test.eth`
namespace — are **NOT readable from a smart contract**.

Why: the CCIP-Read resolver pattern (ERC-3668) returns
`OffchainLookup(...)` from the resolver's view function. The caller
(an off-chain client like a wallet or backend) is expected to catch
that revert, fetch the URL it points at, verify the signature on the
returned payload, and re-call the resolver with the payload as a
calldata argument. The EVM cannot do step 2 of that loop — the
revert just bubbles up to the caller as a normal `revert(bytes)`,
which from inside another contract looks like a failed call.

This has direct consequences for the L4d design:

- The Escrow MUST NOT read ENS records to make tier decisions. We
  exclusively use on-chain registries (IdentityRegistry for owner
  resolution, ReputationRegistry for attestation count).

- ENS records (`x402.amount`, `x402.splitter`, `x402.escrow`,
  `x402.erc8004.agent_id`, etc.) are exclusively for off-chain
  consumers: the buyer SDK, the facilitator's pre-settlement
  resolver, the dashboard frontend. None of these consumers are
  smart contracts.

- The "trust handle" for ENS records is two-fold:
  1. **Gateway signing.** The gateway worker signs every CCIP-Read
     response with `RECKON402_RESOLVER_SIGNER_PK`; the
     Reckon402Resolver contract recovers the signature and reverts
     if it doesn't match the pre-pinned signer EOA. This prevents
     a malicious gateway from forging records for a name we don't
     control.
  2. **ENS owner ACL on writes.** The gateway's `/admin/records`
     endpoint enforces that only the seller's EOA — verified via
     `ENSRegistry.owner(namehash(ensName))` on Ethereum Sepolia —
     can write SellingAgent-class records. Reckon402 (the
     onboarding actor) writes Reckon402-class records during the
     bootstrap window; that window closes the moment ENS ownership
     transfers to the seller.

If a contract needs an "ENS-anchored" value for a security-critical
decision, the value MUST be passed as a function argument by the
off-chain caller, with the caller responsible for fetching it from
the gateway and any signature verification. The contract can then
treat the value as untrusted input and apply its own checks (e.g.
the SplitterFactory's `isDeployed[predicted]` check on
`x402.splitter`).

In Reckon402's case, none of the ENS records are
security-critical inputs to a contract. Splitter addresses are
validated against the on-chain `SplitterFactory.isDeployed` mapping;
agent ids are validated against `IdentityRegistry.ownerOf(agentId)`.
ENS just carries the discoverable handle that maps a human-readable
name to those on-chain anchors.

---

## 4. Why direct Splitter recipients are NOT NFT-bound

The L4d Escrow gates `withdrawAll()` on
`IERC721(identityRegistry).ownerOf(agentId) == msg.sender` so funds
that accumulate in the Escrow follow the agent's NFT around an
ownership change. A natural follow-up question: should the Splitter's
two **direct** recipient slots — slot 0 (seller payout) and slot 1
(facilitator fee) — also be NFT-bound, so the seller can never
"orphan" their direct earnings by transferring the NFT without
updating the Splitter?

**No, by design.** This is an asymmetry, and it is intentional. The
load-bearing distinction is **hold vs forward**:

| Recipient | Funds path | NFT-binding needed? |
|--|--|--|
| Splitter slot 0 (seller) | `transfer()` — funds leave the contract immediately | No |
| Splitter slot 1 (facilitator fee) | `transfer()` — funds leave the contract immediately | No |
| Splitter slot 2 (per-agent Escrow) | `transfer()` to Escrow, which **holds** until tier-gated `withdraw()` | Yes — gated at the Escrow |

The principle: contracts that **hold** funds (`balanceOf > 0`)
between settlement events need an authority check at withdrawal
time. Contracts that only **forward** funds at settlement time
don't have a "withdrawal" operation in the first place — the
recipient is paid by `Splitter.distribute()` itself, which anyone
can call (it's deliberately permissionless to keep settlement
non-blocking).

For the seller payout slot, the seller has already chosen their
custody at deploy time — they signed up with a specific EOA and
that EOA receives 87% of every settlement directly. Adding an
NFT-owner indirection here would mean:

1. **Worse UX.** The seller's preferred custody might be a multisig,
   a Safe, an exchange deposit address, or a hardware wallet — none
   of which need to be the same address that holds the agent's
   IdentityRegistry NFT. Forcing them to align is friction.

2. **No security gain.** A malicious party who steals the NFT can
   already drain the Escrow (which is the design). They can also
   re-target future settlements via signed ENS record writes (the
   `x402.splitter` record). The direct seller slot for *past*
   settlements is by definition already paid out and not at risk.

3. **Substantial new contract surface.** Every Splitter
   `distribute()` call would need to read the IdentityRegistry,
   adding ~3 000 gas per settlement and creating a hard dependency
   on the Identity contract being healthy at settlement time. A
   bug or pause on IdentityRegistry would freeze every settlement
   for every agent. Today the Splitter is a clean immutable
   primitive with zero external reads at distribution time.

The asymmetry is also defensible from a "who custodies what" lens:

- The Escrow's role is to act as a **trust ramp**: a portion of every
  settlement is locked, then released back to the agent's NFT-owner
  as on-chain attestations grow. The whole point of that mechanism
  is "pay the current legitimate operator of this agent" — which is
  exactly the NFT owner.
- The seller payout slot's role is "pay the seller". The seller is
  whoever the operator decided to designate at deploy time. That
  designation is itself an identity claim: by signing the
  `createSplitter()` call, the operator picked an address. If they
  want to migrate that designation later, the cost is one Splitter
  redeploy + ENS-record update, which is a per-agent operation, not
  a per-settlement operation.

### When would we revisit?

If the SellingAgent business model evolves so that ownership-of-
agent-NFT is the canonical "who owns the revenue stream" semantic
(Path B in `specs/01-eoa-topology.md`'s Q-01-5), the Splitter's
direct slots would migrate to NFT-binding alongside the Escrow.
That's a v2 reckon402 platform direction — not a hackathon-scope
change. We surface it here so the asymmetry is recorded as an
explicit decision rather than an oversight.

### Migration cost (recorded for completeness)

If we *did* want to NFT-bind the seller slot tomorrow:

- **Contract changes**: ~25 LOC. New `SellerPayoutForwarder.sol` that
  reads `ownerOf(agentId)` and forwards to that address; deploy one
  per agent through `SplitterFactory` alongside the Splitter. Could
  also be done as a Splitter ABI extension (`recipientResolver`
  interface), but that breaks immutability claims.
- **Frontend / orchestrator changes**: substantial — the dashboard's
  "seller" recipient label would now require a live owner-lookup; the
  onboarding flow would need a "redirect-payouts" UI for NFT
  transfers; `tools/onboard/src/orchestrator.ts` would need to write
  the forwarder address (not the seller EOA) into the Splitter at
  step 4.
- **New attack surface**: every settlement now reads
  IdentityRegistry. If that contract pauses, every Reckon402
  settlement halts.

The cost equation skews toward "leave it as a v2 platform
direction"; the Escrow's NFT-binding is sufficient for the
hackathon-scope trust story.

---

## Summary table

| Concern | Where the load-bearing protection lives | Reckon402's contribution |
|--|--|--|
| Sybil on attestation count | `ReputationRegistry.giveFeedback` derives `clientAddress` from `msg.sender` | Pin `facilitatorClient` + `(tag1, tag2)` in the Escrow constructor; Escrow reads only attestations matching that tuple |
| Bypass risk (Escrow ignoring ERC-8004 entirely) | `Escrow.attestationCount()` reads via cross-contract STATICCALL | One source of truth for the public reputation count; Escrow is a thin pricing layer above it |
| Forged ENS records | Gateway-signed CCIP-Read responses + Reckon402Resolver signer recovery + ENS-owner ACL on writes | Gateway is the signing oracle; ENS is never consulted by a contract for authority decisions |
| Direct Splitter recipients change of custody | Operator-signed Splitter redeploy + ENS-record update | Splitter is immutable + permissionless `distribute()`; "hold" funds get NFT-bound (Escrow), "forward" funds do not (seller payout slot) |

These dispositions are pinned in:

- `AGENTS.md` § "L4d on-chain Escrow (v1, locked)" → "Q-09-* dispositions"
- `specs/09-l4d-escrow.md` § Open questions → Q-09-5 / Q-09-6 / Q-09-7
- `contracts/src/Escrow.sol` — module docstring + the `attestationCount()`
  function comment

If a future iteration relaxes any of these properties (e.g. supports
multi-facilitator aggregation, or moves a tier-relevant input to an
ENS record), the corresponding row in the table above MUST be
re-justified before merge.
