# 06 — Actor / Act matrix (who signs, who broadcasts, who pays, why)

**Status:** Locked 2026-04-29 at the L4b framing gate. Captures the
taxonomy that resolved a signer/broadcaster/gas-payer confusion during
L4b design. Any future layer that adds a new on-chain or off-chain
act against x402 + ERC-8004 cross-checks against this matrix before
committing to an implementation.

**Scope.** x402 v2 settlement flow (L3, shipped) + ERC-8004 reputation
writes (L4b, in flight) + ERC-8004 reads (L4a2, shipped). Does NOT
cover agent registration in IdentityRegistry (one-shot, manual, out
of hot path) beyond naming it in the matrix.

---

## 1. Why this doc exists

Multiple L4b design discussions hit the same confusion: "who signs
`giveFeedback`?" The ambiguity came from collapsing four distinct
questions into one:

1. Who produces the cryptographic signature?
2. Who submits the transaction on-chain?
3. Who pays gas?
4. Whose EOA is recorded as `msg.sender` / `clientAddress`?

These are four answers, not one. The matrix in §4 forces them apart.

Second-order confusion came from conflating two types of on-chain
feedback that ERC-8004 supports side-by-side:

- **DXa — buyer satisfaction.** `clientAddress = buyer`, tag-family
  `quality`-ish. Buyer attests to their own experience.
- **DXb — facilitator-observed settlement.** `clientAddress =
  facilitator`, tags `("payment", "x402-settlement")`. Facilitator
  attests that settlement happened for a seller agent at price P.

Same contract, same function, different semantics, different
signers, different trust models. §6 locks DXb as the Reckon402 main
rail and defers DXa.

---

## 2. Dimensions

### 2.1 Business actors

| Actor | Role | Custody profile | Liveness requirement |
|-------|------|-----------------|----------------------|
| **Buyer agent** | Originates the paid request; signs EIP-3009 authorization | Holds USDC; holds private key (BYO wallet OR delegated to KMS in KH-demo path) | Online at payment time; offline otherwise |
| **Seller agent** | Renders the paid service; subject of reputation | No USDC custody; owns ERC-8004 agentId | Online at service-delivery time; offline otherwise |
| **Facilitator** | Validates EIP-3009, submits settlement tx, orchestrates Splitter + attestation writes | No buyer funds custody; holds own EOA for gas; operates as on-chain oracle for DXb | Online during the settlement window and attestation write |
| **Marketplace owner** | Reckon402 org; operates the facilitator + gateway + KMS | Same custody profile as facilitator; plus off-chain infrastructure (CF Workers, AWS KMS, Infisical) | Online continuously |
| **Relayer / meta-tx sponsor** | *(Not used at L4b.)* An actor who broadcasts on behalf of a signer and pays gas under EIP-2771 / 4337 | N/A | N/A |

Relayer is named for completeness and as a forward-compat slot. ERC-8004
at the pinned commit has no trusted-forwarder support — `msg.sender`
is authoritative. Meta-tx plumbing is post-hackathon.

### 2.2 Acts

Acts are decomposed into **sign** vs **broadcast** vs **read** so
that one actor can do one without implying the other.

| Act | Off-chain / on-chain | Signer | Broadcaster | Gas payer | Reads from |
|-----|----------------------|--------|-------------|-----------|------------|
| A1. Sign EIP-3009 `TransferWithAuthorization` typed-data | off-chain | Buyer key | n/a | n/a | n/a |
| A2. Broadcast `USDC.transferWithAuthorization(..., v, r, s)` | on-chain | Facilitator key | Facilitator | Facilitator (from EIP-3009 fee slot) | USDC |
| A3. Broadcast `Splitter.distribute(paymentId, amount)` | on-chain | Facilitator key | Facilitator | Facilitator (from EIP-3009 fee slot) | Splitter |
| A4. Sign + broadcast `ReputationRegistry.giveFeedback(...)` (DXb) | on-chain | Facilitator key | Facilitator | Facilitator (from EIP-3009 fee slot) | ReputationRegistry |
| A5. Read `ReputationRegistry.getClients` / `.getSummary` | off-chain (RPC read) | n/a | n/a | n/a | ReputationRegistry |
| A6. Read `IdentityRegistry.ownerOf` / `.getAgentWallet` | off-chain (RPC read) | n/a | n/a | n/a | IdentityRegistry |
| A7. Read ENS text records | off-chain (CCIP-Read) | n/a | n/a | n/a | ENS registry + Reckon402Resolver |
| A8. Register agent in IdentityRegistry | on-chain, one-shot | Seller key (or proxy) | Seller (or proxy) | Seller | IdentityRegistry |
| A9. Set ENS text records (`x402.*`) | on-chain, one-shot | Seller key | Seller | Seller | ENS resolver |
| A10. Write `ValidationRegistry` attestation | on-chain | Third-party validator | Validator | Validator | ValidationRegistry |
| A11. (Deferred) Sign buyer-satisfaction attestation (DXa) | on-chain | Buyer key | Buyer (or relayer) | Buyer (economics problem) | ReputationRegistry |

A10 is blocked on upstream deployment — ValidationRegistry is `null`
at the pinned commit across all supported chains. Library surfaces
throw `VALIDATION_NOT_DEPLOYED`.

A11 is deferred per §6. Notes captured in §8 forward-compat.

### 2.3 Topics of concern

- **a. Gas** — per-act cost and who bears it.
- **b. Signer key** — where the key material lives, who operates it.
- **c1. Access control** — who can become an agent / client /
  attester without a gatekeeper.
- **c2. Non-custodial trust** — does any actor have to trust another
  with funds?
- **d. Registration** — is a one-time setup needed; who does it.
- **e. Batching** — per-settlement vs aggregated writes.
- **f. Liveness** — which actor must be online at step T.
- **g. Broadcasting vs signing** — explicit separation.

### 2.4 Criteria

Applied to each decision in §4:

- **i. Economic viability** — is cost-per-act defensible?
- **ii. Technical viability** — is the required key/actor actually
  available at that step?
- **iii. UX** — is the action bearable by the actor or will it
  silently not be adopted?
- **iv. Strategic fit** — aligned with moat (settlement-attestation
  primitive) and submission framing?
- **v. Mechanism-design fit** — resistant to spam, sybil,
  misattribution?
- **vi. Reversibility / lock-in cost** — on-chain state is permanent;
  how bad is an error?

---

## 3. The three ERC-8004 registries

| Registry | Purpose | Base Sepolia address | Our usage | L4b touch? |
|----------|---------|----------------------|-----------|------------|
| **IdentityRegistry** | Maps agentId (NFT tokenId) ↔ owner wallet ↔ tokenURI | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | **Read only.** Gateway resolves sellerWallet → agentId; facilitator resolves sellerWallet → agentId before writing attestation | No new code; library exists |
| **ReputationRegistry** | Per-agent feedback entries with tags; emits `NewFeedback` events | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | **Read + Write.** Gateway reads `getClients` + `getSummary` for tier pricing (L4a2, shipped). Facilitator writes `giveFeedback` tagged `("payment", "x402-settlement")` per confirmed settlement (L4b, new) | **YES — L4b write path** |
| **ValidationRegistry** | Third-party validators (e.g. TEE services) attest "I verified agentId produced output X for input Y" | `null` — not deployed | **Blocked upstream.** Library surfaces throw `VALIDATION_NOT_DEPLOYED`. Upstream notes "under active TEE-community discussion" | No — blocked |

---

## 4. Locked decisions (D1–D14)

### D1. Who signs EIP-3009 `TransferWithAuthorization`?

**Decision:** Buyer key. Non-negotiable — canonical x402 non-custodial
contract.

**Paths:**
- KH-demo: buyer key is in AWS KMS, exposed via Lambda
  `signing.reckon402.com/sign` with strict EIP-712 validator.
- BYO-wallet: buyer supplies any viem account to
  `@reckon402/buyer-sdk`.

**Criteria met:** ii (buyer is online at payment time), iv (keeps
facilitator non-custodial), v (signature is proof of buyer intent).

---

### D2. Who broadcasts `USDC.transferWithAuthorization`?

**Decision:** Facilitator. Gas paid from facilitator's cut in
EIP-3009 Splitter slot.

**Criteria met:** i (facilitator's cut covers gas at all demo unit
prices), ii (facilitator always online), iv (meta-tx pattern is
x402's central contribution; keeps buyer gas-free on the payment
side).

---

### D3. Who signs `ReputationRegistry.giveFeedback` for settlement
attestations (DXb)?

**Decision:** **Facilitator key.** Same `FACILITATOR_PK` that signs
`transferWithAuthorization` and `distribute`.

**Reversal note:** Earlier design drafts proposed the buyer key
signs giveFeedback, on the reasoning that `msg.sender ==
clientAddress` would otherwise make the facilitator appear as "the
client" in every record. That reasoning is valid for DXa (buyer
satisfaction) but wrong for DXb (settlement-observation).

**Why facilitator is correct for DXb:**
- `NewFeedback(agentId, clientAddress, …)` records a claim; the
  semantics of the claim depend on what's being attested and what
  tag family it uses.
- DXb tags are `("payment", "x402-settlement")`. The claim is
  literally *"facilitator F observed settlement for agent Y at price
  P."* Only the facilitator is in a position to make that claim —
  the buyer didn't witness Splitter's `distribute()`, the seller
  didn't witness the payment validation.
- Consumers downstream of ERC-8004 can distinguish DXa from DXb by
  tag. A Tradewise-style indexer that weighs facilitator-tagged
  entries as oracle-style attestations and buyer-tagged entries as
  subjective-ratings is consuming the signal correctly.
- Buyer EOAs do **not** appear in Reckon402-written reputation
  records. Automatic pseudonymity at the reputation layer, as a
  byproduct of the correct signer choice.

**Criteria met:** ii (facilitator is the only actor in a position to
witness settlement), iii (buyer needs no post-payment action), iv
(moat: settlement-attestation primitive that nobody else ships; name
is explicit in tag), v (intentional oracle pattern, not a
misattribution; buyer-side sybil is impossible because buyer doesn't
write).

---

### D4. Who broadcasts `giveFeedback`?

**Decision:** Facilitator. Same tx originates signature and broadcast
— no separation needed since the facilitator is both signer and
broadcaster for DXb.

---

### D5. Who pays gas for `giveFeedback`?

**Decision:** Facilitator, from the EIP-3009 fee slot (same source
as D2, D3).

**Economics:** ~80k gas @ Base Sepolia typical ≈ $0.0002 per write.
At the canonical 0.01 USDC demo unit price that is 2% overhead; at
0.1 USDC it is 0.2%. Per-settlement writes are demo-economic and
production-economic at Base gas levels.

**Criteria met:** i (cost is a rounding error at Base gas; facilitator
fee covers it), iii (buyer has zero involvement in attestation
gas).

---

### D6. How is the attestation write triggered?

**Decision:** **Inline `ctx.waitUntil(maybeWriteAttestation(...))`
inside `workers/facilitator/src/settle.ts`**, at the end of the
success path after `distribute()` confirms. Cron-based retry
reconciler is OPTIONAL, behind a feature flag, for the error tail
only.

**Reversal note:** Earlier drafts (and `02_facilitator.md` §10.1)
called for a Cron Trigger polling `eth_getLogs` for Splitter
`Distributed` events. That design assumed the facilitator was
externally observing an event produced by a different actor. In our
topology, the facilitator is the one submitting `distribute()` — it
already knows the moment settlement completes. A cron watcher is
dead weight.

**Implications of inline trigger:**
- No `watcher_state` table. No `last_seen_block` bookkeeping.
- No Workers Paid requirement (cron optional, retry-only).
- Attestation tx lands within the same ~4-second settlement window.
- If the attestation write fails (revert, RPC outage), the payment
  state remains CONFIRMED/RECONCILED. Attestation is a bonus, not a
  block.

**Optional retry reconciler (behind `WRITES_RETRY_CRON_ENABLED`):**
once-per-minute sweep for `state='RECONCILED' AND td_erc8004_tx IS
NULL AND confirmed_at > now - 1h`. Enables production robustness
without being demo-critical.

**Criteria met:** i (no extra infra spend for the happy path), ii
(facilitator already has the distribute-tx hash in memory), iii (zero
cron-cadence mismatch in the demo voiceover).

---

### D7. Merchant opt-in?

**Decision:** Seller sets ENS text record `x402.attestation = "on"`
at onboarding. Facilitator reads this via the gateway before
writing. No record or value ≠ "on" → skip silently.

**Criteria met:** iv (seller explicitly opts in to being attested
for; opt-out is default).

---

### D8. Buyer opt-in / privacy?

**Decision:** Not needed for the DXb rail — buyer never appears in
Reckon402-written reputation records. Pseudonymity is automatic
(§D3). DXa would require a buyer opt-in mechanism; deferred (§D13).

---

### D9. Who registers agents in IdentityRegistry?

**Decision for the hackathon:** Seller (or manual operator) registers
once pre-demo. One seller agent pre-registered on Base Sepolia;
agentId pinned in `gateway/migrations/seed_l4a2.sql`. No hot-path
registration in L4b.

**Strategic path lock:** **Path A — facilitator-only, not
agent-platform.** Reckon402 does NOT operate an agent-identity
factory, does NOT tokenize agent revenue streams, does NOT offer
legacy-ID carryover. These are platform-lock-in features that
conflict with the open-primitive framing that sponsor judges reward.

**Forward-compat slot:** Path B (platform with tokenized revenue
streams + legacy-ID migration) is a genuine moat direction — but
post-hackathon. Flagged as roadmap in README. Deciding not to build
it now costs nothing; deciding to build it now costs focus we cannot
spare.

**Criteria met:** iv (open-primitive framing), vi (no permanent
lock-in decisions).

---

### D10. Where does the buyer key live?

**Decision:** Two paths, same key material:
- **KH-demo path:** AWS KMS (`alias/reckon402/mainnet/buyer-signer/evm`,
  key ID `5a0350e0-d502-4579-8d45-d31c843a5f3f`, EOA
  `0x46bbb05aca9ea24118b8a57c8d3f317503384305`). Operated by the
  Lambda at `signing.reckon402.com/sign` with the narrow EIP-712
  validator per `specs/04_signing_wrapper.md` §4.6 (no arbitrary
  digest path).
- **BYO-wallet path:** caller supplies any viem account to
  `@reckon402/buyer-sdk`.

**Non-scope expansion:** Lambda ships with exactly **one** endpoint
(`/sign`) for EIP-3009 TransferWithAuthorization only. It does NOT
get a second endpoint for signing `giveFeedback` txs, because under
D3 the facilitator key (not buyer key) signs those. §4.6 discipline
preserved.

**Criteria met:** ii (buyer key available at payment time from
either path), iv (KMS is industry-standard; narrow validator is
defensive-depth).

---

### D11. Batching attestations?

**Decision:** Per-settlement writes for hackathon. No batching.

**Forward-compat v1.5:** Batching unlocks two things: (a) further
gas amortization at sub-cent unit prices, (b) a form of buyer
privacy in settlement if the batch groups multiple buyers' settlement
into one attestation (hiding individual timing). Neither is a
hackathon blocker. When gas economics shift or buyer-privacy becomes
a priority, revisit.

**Criteria met:** i (per-write gas is acceptable at Base), iii (no
implementation complexity that delays demo).

---

### D12. Lambda scope expansion?

**Decision:** **DELETED.** This question existed only under the
earlier (incorrect) D3 resolution. Under the locked D3 (facilitator
signs giveFeedback, not buyer), the Lambda needs no additional
endpoint. §4.6 "no arbitrary digest path" holds unchanged.

---

### D13. DXa (buyer satisfaction) vs DXb (facilitator-observed) —
which is the Reckon402 main rail?

**Decision:** **DXb is the main rail. DXa is NOT shipped as an
optional API either.**

**Why DXa is not shipped even as opt-in:**
- Shipping DXa as a side rail creates a negative interaction with
  DXb: downstream consumers must weight them somehow. Weighting DXa
  higher invites sybil-buyer attacks (any buyer can farm reputation
  for a cooperating seller). Weighting DXa lower begs the question
  "why ship an under-weighted signal?"
- The cleaner story: *"Reckon402's ReputationRegistry writes are
  settlement-attestation records. Subjective satisfaction reviews
  are someone else's primitive to build — and they can use the same
  contract."* This keeps the reputation semantics tight and our
  submission framing sharp.
- Forward-compat: the slot stays open. DXa could be implemented by
  a different project consuming the same ReputationRegistry, with
  its own tag family. We don't close the door; we just don't walk
  through it.

**Economic sub-argument:** DXa has no natural forcing function
(classic review-site problem — buyer has no incentive to leave
feedback post-service) and creates gas cost for buyers (bad UX).
Designing around these is a rabbit hole; solving them is a separate
primitive entirely.

**Criteria met:** iv (tightens submission framing), v (no sybil
surface through Reckon402), vi (no irreversible commitment to a
signal we might not believe in).

---

### D14. ValidationRegistry writes?

**Decision:** Nothing for us to do. Upstream ValidationRegistry is
`null` at the pinned commit across every supported chain. The
`@reckon402/erc-8004-client` library exposes Validation surfaces
that throw `VALIDATION_NOT_DEPLOYED`. Re-visit when upstream ships.

**Criteria met:** ii (blocked upstream; honest surface).

---

## 5. Summary matrix

Compact reference for judges / new contributors:

| Act | Actor(s) | Key source | Gas source | Notes |
|-----|----------|-----------|-----------|-------|
| A1. Sign EIP-3009 | Buyer | KMS (KH demo) OR BYO-wallet | — | off-chain |
| A2. TransferWithAuthorization | Facilitator | FACILITATOR_PK | Fac fee slot | L3 shipped |
| A3. Splitter.distribute | Facilitator | FACILITATOR_PK | Fac fee slot | L3 shipped |
| A4. giveFeedback (DXb) | Facilitator | FACILITATOR_PK | Fac fee slot | L4b new |
| A5–A7. Reads | — | — | — | L4a2 shipped |
| A8. Register agent | Seller | Own wallet | Own | Pre-demo, one-shot |
| A9. Set ENS records | Seller | Own wallet | Own | Pre-demo, one-shot |
| A10. Validation write | Validator | Own | Own | Blocked upstream |
| A11. DXa attestation | Buyer | Buyer | Buyer | Not shipped |

---

## 6. Implications for other specs

- `02_facilitator.md` §10.1 (Cron watcher for Distributed) is
  superseded by D6 (inline `ctx.waitUntil`). Do NOT implement the
  `watcher_state` table.
- `02_facilitator.md` §10.2 (ERC-8004 conditional write) pseudocode
  referenced `appendFeedback` — the upstream function at the pinned
  commit is `giveFeedback` with 8 args, which the
  `@reckon402/erc-8004-client` library already implements correctly.
  The spec prose is stale; the code is right.
- `04_signing_wrapper.md` ships unchanged — single endpoint, EIP-3009
  scope only, §4.6 discipline preserved.
- L4b implementation work is in `workers/facilitator/` only
  (treasury/attestation.ts + settle.ts `ctx.waitUntil` wire-up + D1
  migration + optional reconciler + gateway cache-invalidate call).

---

## 7. Open questions

| ID | Question | Disposition |
|----|----------|-------------|
| Q-06-1 | Does `ctx.waitUntil` reliably complete a ~2-second attestation write within CFW's background-task budget? | Verified during L4b smoke; if flaky, add retry-reconciler |
| Q-06-2 | When upstream deploys ValidationRegistry, do we opt in as a validator for our own settled payments (double-attesting DXb)? | Defer — decision waits for upstream |
| Q-06-3 | DXa forcing function — is there a separate Reckon402 primitive (e.g., discount-for-review) that makes DXa economic without sybil exposure? | Post-hackathon research |
| Q-06-4 | Buyer-privacy via batching (§D11 v1.5) — does the on-chain model support aggregating multiple settlements into a single `giveFeedback` emission without losing per-payment auditability? | Research; gas-economics-dependent |

---

## 8. References

- `AGENTS.md` — locked EOA topology, locks table, L4a2 shipped state.
- `specs/04-l4a-gateway.md` — L4a2 ERC-8004 read-side implementation.
- `02_facilitator.md` (design pack) — superseded in §10.1–§10.2 per
  this doc's §6.
- `04_signing_wrapper.md` (design pack) — ships unchanged.
- `packages/erc-8004-client/src/reputation.ts` — library surfaces
  that L4b will call.
- `workers/facilitator/src/settle.ts` — site of the L4b
  `ctx.waitUntil` wire-up.
