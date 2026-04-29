# Reckon402 — Economic Model Analysis (strategy doc, not spec)

Status: DRAFT for founder review, 2026-04-29.
Purpose: resolve the pricing/reputation incoherence before landing-page and pitch
copy are locked. Captures the founder's objection, inspects the live code, and
recommends a direction.

---

## 1. Ground truth from the live code

Before theorising, what the shipped system actually does:

### 1.1 Splitter (`contracts/src/Splitter.sol`)

- Immutable. Recipients and BPS are baked in at deploy; BPS must sum to 10_000.
- `distribute(paymentId, amount)` sends 100% of `amount` to the fixed recipient set.
- **There is no facilitator recipient unless the merchant put one in at deploy time.**
- Per-settlement fee variation is impossible without redeploying or a new contract.

### 1.2 Gateway pricing (`gateway/src/resolution/pricing.ts`)

- `tierBpsFromCount(count)` — step function:
  - `0 attestations` → 0 bps
  - `1–2` → 500 bps
  - `3–9` → 1000 bps
  - `10+` → 1500 bps
- `applyPricingTier` reduces `x402.amount` by that bps, or attaches
  `discount_bps` to `x402.pricing` JSON.
- Pure off-chain code. Hot-swappable. Does not touch the Splitter or facilitator.

### 1.3 Attestation write (facilitator post-CONFIRMED hook)

- Writes `appendFeedback` about the **seller agent** with tag `x402-settlement`.
- This grows the count that `tierBpsFromCount` reads. Loop closed.

### 1.4 Actor/lever matrix

| Actor        | What they set                                       | Mutable post-deploy? |
|--------------|-----------------------------------------------------|----------------------|
| Merchant     | Base `x402.amount` in ENS text record               | Yes (ENS record)     |
| Merchant     | Splitter recipients + BPS                           | **No** (immutable)   |
| Gateway      | Reputation-tier modifier (bps delta)                | Yes (worker code)    |
| Facilitator  | Nothing about pricing; only executes settlement     | n/a                  |
| Buyer        | Pays whatever the gateway returns                   | n/a                  |

---

## 2. The founder's objection (recorded)

> "Of the price advertised to the buyer: who sets it? Who gets what? The easiest
> would be that the facilitator fee is reduced for trusted agents. If it is the
> seller, then it is not clear what the feature is — the seller can change its
> price anyway. So what is the feature or benefit?"

This objection has two parts. Both are correct and must be resolved.

### 2.1 "Seller-owned premium" collapses under seller price autonomy

In the previously-recommended flip (seller's rep → advertised price goes **up**),
the seller captures more per transaction. But:

- The seller already owns the ENS text record, i.e. the base price.
- A seller could therefore raise the base price themselves, without the gateway.
- If the only contribution of the gateway is to multiply the seller's price by a
  factor the seller could apply themselves, the gateway's pricing branch is
  decorative.

The *only* way the gateway's pricing adds real value in a seller-benefit model:
the gateway is a **credible pricing oracle keyed to unfakeable on-chain
reputation**. Buyers trust the returned price *because* it is derived by a
public deterministic function from an on-chain attestation count the seller
cannot forge. The seller could still raise the base price unilaterally, but
they cannot claim "reputation tier 3" without earning it.

This is true but thin at hackathon scale. It asks judges to buy a subtle
oracle-value argument.

### 2.2 "Facilitator fee reduced for trusted sellers" does not fit the current Splitter

Economically this is the cleanest story. Implementation-wise it is blocked:

- The Splitter has no facilitator slot unless the merchant added one at deploy time.
- Varying the facilitator's cut **per settlement** requires contract changes.
- Redeploying a Splitter per reputation tier would break the merchant's
  advertised Splitter address and the ENS record pointing at it.

A minimal version *is* shippable if every merchant deploys the Splitter with a
facilitator slot at, say, `[merchant 9000, facilitator 1000]`, and the gateway's
pricing function reduces the **advertised amount** to `base * (1 - rep_discount)`
with the understanding that the reduction comes out of the facilitator's slice.
But this only works **on paper**: the Splitter does not know the advertised
amount; it distributes whatever it received by fixed BPS. So a shrunk pot
shrinks everyone proportionally, not just the facilitator.

To deliver "facilitator-cut varies with reputation" literally, you would need:

1. A facilitator contract that receives USDC first, keeps a reputation-dependent
   cut, then forwards the remainder to a merchant-chosen Splitter, **or**
2. A Splitter v2 whose facilitator slot takes an absolute amount (not BPS),
   with the facilitator cut supplied per call.

Option 1 violates non-custodial design (facilitator briefly holds funds).
Option 2 is a new contract, audit, redeploy, SDK change. Neither fits the
4-day window.

---

## 3. The honest assessment

Both of the clean stories are blocked:

- "Seller-owned premium" is coherent but weak (seller price autonomy).
- "Facilitator-fee discount for trust" is strong but requires contract work
  we do not have time for.

What we can ship without touching contracts, ordered by honesty:

### Option A — Keep current direction, reframe as "attestation-write is the product"

Pricing is demonstrative, not central. The claim is: **Reckon402 is the first
system that closes the x402 → ERC-8004 loop** — every settlement mints a
verifiable on-chain reputation attestation about the seller. Downstream
consumers (our own gateway, other marketplaces, lending protocols, insurance)
can then price, whitelist, or underwrite off that attestation stream.

Our gateway demos one such consumer: a step-function price modifier. The value
Reckon402 delivers is the **attestation primitive**, not this particular
modifier. This is defensible: competitive positioning note already says
"Tradewise reads 8004 but doesn't write; the write-side is the differentiator."
Lean into that, stop framing the gateway's discount as the product.

- Pitch: "Every x402 settlement now leaves a permanent, verifiable reputation
  trail on ERC-8004. Reckon402 is the write-side of agent commerce."
- Code change: none.
- Seller benefit: reputation as a portable asset they can use anywhere 8004 is
  read. We don't promise seller revenue per settlement; we promise portable
  creditworthiness.
- Buyer benefit: the gateway demo shows one way buyers use the attestation
  stream. Others will emerge.
- Risk: "You built the pipe, not the economy." True. But the hackathon thesis is
  infra, and the pipe is what's missing in the ecosystem. Own that.

### Option B — Flip pricing to seller-premium AND add a verifiability claim

Keep the sign-flip recommended previously (high rep → higher advertised price),
but pair it with: **the gateway publishes the pricing function and the
reputation read is on-chain, so the premium is verifiable**. Seller cannot
spoof tier. This addresses §2.1 partially.

- Pitch: "The gateway prices seller agents by their earned on-chain reputation;
  proven sellers get a verifiable premium, unproven sellers compete to earn in."
- Code change: three constants in `pricing.ts:7` (flip sign).
- Weakness: the seller can still unilaterally raise base price. The gateway's
  pricing function is an oracle, not a binding market mechanism. Judges who push
  will expose this.

### Option C — Partial facilitator-cut story via merchant Splitter config

Do not change contracts. Instead: instruct demo merchants to deploy their
Splitter with an explicit facilitator slot (e.g. 500 bps). Advertise the
gateway's pricing function as a **facilitator-subsidy curve**: high-rep sellers'
advertised price is reduced by an amount equal to (or less than) the facilitator
slot's BPS. The facilitator operator commits to setting the advertised discount
≤ their BPS slice; the difference is the facilitator eating cost for trusted
sellers.

- Pitch: "For proven sellers, the Reckon402 facilitator absorbs its own fee,
  passing the savings to buyers. The facilitator compensates by charging
  unproven sellers the standard fee."
- Code change: pricing.ts constants tuned to match merchants' facilitator BPS.
  No contract change. Demo merchant Splitter must have a facilitator slot.
- Seller benefit: zero direct; they get "lower buyer price → better conversion,"
  same weak indirect benefit as before.
- Facilitator benefit: none in the demo; it's just eating cost to show the
  shape of the model. In production it would balance across tiers.
- Honesty flag: because the Splitter distributes by fixed BPS regardless of
  advertised price, the "facilitator absorbs the fee" narrative is a
  *representation*, not a mechanically-enforced split. A careful judge will
  notice that a smaller advertised amount shrinks the merchant share too. You
  can disclose this honestly by saying "this is the pricing interface; the
  contract enforcement of asymmetric fee absorption lives in Splitter v2."

### Option D — Bite the bullet: ship a thin facilitator-cut contract

A minimal Splitter-with-dynamic-facilitator-slot is maybe 40 lines. But:
redeployment, re-verification, SDK update, Worker update, merchant re-deploy,
new tests, new attestation write path. Realistically 1–2 days if nothing
surprises you. Not advisable with 4 days to deadline and other loose ends.

---

## 4. Recommendation

**Ship Option A as the primary pitch narrative. Keep the current code.**

Reasoning:

1. It is the most honest given shipped infrastructure. "We closed the x402 →
   8004 write loop" is a fact judges can verify in ~2 minutes by watching the
   facilitator's post-settlement attestation write.
2. It refuses to over-claim on economic mechanism design. Trying to argue a
   specific pricing theory in 60 seconds with a weak underlying mechanism is
   how a pitch gets punctured.
3. It preserves the gateway's pricing demo as **one instance of a consumer**,
   not the thesis. If a judge says "the pricing story is thin," the answer is
   "it's one example — any 8004 reader can now price, underwrite, or gate off
   this attestation stream."
4. Landing-page headline becomes writable without ambiguity:
   > "Reckon402 writes every x402 settlement to on-chain reputation."
   > "One line of x402, every transaction leaves a receipt on ERC-8004."

**Fallback if you insist on a sharper economic claim: Option C.** It has
narrative clarity ("facilitator absorbs fee for trusted sellers") and costs
nothing in code, but carries a mechanical-honesty risk that must be disclosed.

**Do not ship Option B alone.** The seller-price-autonomy objection makes it
fragile in a Q&A.

**Do not attempt Option D** within the remaining window.

---

## 5. Specific code/copy actions if Option A is accepted

1. **Landing page**: rewrite the headline from any price-centric framing to
   attestation-write framing. Pricing demo moves below the fold as "one example
   consumer."
2. **`gateway/src/resolution/pricing.ts`**: leave as-is; function is demo, not
   thesis. Consider renaming to `applyDemoTier` in a README comment so the
   positioning is unambiguous.
3. **Demo narration**: order the flow as (a) buyer hits endpoint, (b) 402, (c)
   signer produces EIP-3009 auth, (d) facilitator settles, (e) **attestation
   appears on 8004, Etherscan-linked live** ← this is the hero moment, (f)
   next settlement reads the new count. The pricing delta is the tail, not the
   hero.
4. **Positioning slide**: "Tradewise reads 8004. Reckon402 writes it." (Single
   line, single comparison, verifiable on both sides.)
5. **FAQ prep**: rehearse the Q "what is the seller's economic incentive to
   adopt Reckon402?" Answer: portable on-chain reputation, consumed by any 8004
   reader including but not limited to our gateway. Pull-through examples:
   lending, insurance, discovery, whitelisting.

---

## 6. Open questions for founder

- Is portable on-chain reputation (Option A) a strong enough thesis for this
  prize track, or does the jury expect an explicit monetary flow to point at?
  If the latter, Option C is the fallback with the understood honesty caveat.
- Has any existing demo merchant Splitter been deployed with a facilitator
  slot? If yes, Option C is a tiny pricing-constant change away. If no, Option
  C requires a new merchant Splitter deploy for the demo.
- Is there appetite to frame the gateway's pricing function as "policy, not
  protocol" in the pitch? This is the key disclosure that makes Option A
  robust against "but you're just multiplying their price by a number."

---

## 7. Seller-perk candidates beyond fee redirection

Framing: fee redirection (facilitator reimburses seller via separate transfer)
does not move the needle — it just repartitions the same payment without
creating new economic value. The perks below leverage the gateway's two real
superpowers: (a) being the resolver endpoint every buyer hits first, and
(b) observing every settlement on 8004. This only works if Reckon402 is
positioned as marketplace infrastructure, not just a payment pipe.

### Tier 1 — high demo credibility, low code cost

**A. Directory / ranking in a gateway-hosted marketplace**
- Mechanic: new Worker route `GET /sellers` (optionally `?category=X`) returns
  agent list sorted by 8004 attestation count.
- Demo: settlement confirms → rep ticks up → refresh directory → seller moves up.
- Why it moves the needle: seller revenue is bounded by discoverability; live
  on-chain rank changes are visually transformative.
- Fits vertical-integration story: Reckon402 as marketplace, not payment pipe.
- Effort: ~4h. One Worker route + one query over 8004 reads or a cached index.

**B. Advertised-price ceiling unlocked by tier**
- Mechanic: gateway rejects or clips resolution responses whose `x402.amount`
  exceeds the tier's ceiling. Tier 0 → $1 max, tier 3 → uncapped.
- Demo: low-rep seller's $50 ask is clipped to $1; proven seller's passes.
- Why it moves the needle: **answers the price-autonomy objection from §2.1
  directly** — the seller cannot raise price past the tier cap because the
  gateway enforces it. Direct revenue lever, no contract change.
- Effort: ~2h. One check in `resolution/dispatch.ts` or `pricing.ts`.

**C. Rate limit / throughput tier**
- Mechanic: gateway enforces max settlements per seller per window via a KV
  counter. Tier 0 → 5/hr, tier 3 → unthrottled.
- Why it moves the needle: hard revenue ceiling that lifts with reputation.
- Effort: ~3h.

### Tier 2 — medium credibility, medium cost

**D. Instant-settle / facilitator advance**
- Mechanic: for high-rep sellers the facilitator pre-funds from its **own**
  treasury before the buyer's tx mines; reconciles when it lands. Buyer auth
  is still off-chain signed (no user custody), but the facilitator operator
  takes a financial position.
- Demo: two sellers paid at the same moment; tier-3 seller sees USDC before
  the on-chain settlement confirms.
- Why it moves the needle: the only mechanism on this list that gives a
  genuine "Stripe instant payout" pitch defensibly.
- Honesty flag: requires disclosing the facilitator holds a treasury.
- Effort: ~1 day. Treasury contract + facilitator flow + reconciliation.

**E. Lead routing / default category match**
- Mechanic: buyer asks gateway `?category=translation`; gateway auto-resolves
  to highest-rep matching seller.
- Effort: ~4h; requires a `category` tag in seller records.

**F. Verified-tier flag in 402 payload**
- Mechanic: gateway injects `"verified_tier": N` into `x402.pricing`; buyer SDK
  renders a badge or auto-approves without human confirmation above some tier.
- Weaker (signaling, not mechanism) but nearly free.
- Effort: ~1h.

### Tier 3 — skip for this hackathon

Priority queue, gas-sponsorship scaling by tier, analytics dashboard access,
dispute-resolution tiers. Either cosmetic, or depend on infrastructure we do
not have.

### Recommended stack for the pitch

- **Hero: A (directory ranking).** Cheapest and most visual; explicitly makes
  the case that Reckon402 is marketplace infrastructure.
- **Pair: B (price-ceiling unlock).** Solves the price-autonomy objection
  from §2.1 mechanically. Together with A the pitch is two-beat:
  *discovery up, earning ceiling up*.
- **Reserve: D (instant settle).** Stretch goal or post-hackathon roadmap
  slide if you want an economic claim sharper than A+B.

### One-sentence pitch options by combination

- A alone: *Reckon402 ranks seller agents by on-chain reputation earned
  from every x402 settlement — proven sellers rise in the directory
  automatically, with no claim the seller can fake.*
- A + B: *Every x402 settlement mints an ERC-8004 attestation; reputation
  unlocks directory placement and higher earning ceilings, verifiable
  end-to-end on-chain.*
- D: *Reckon402 pre-funds proven sellers the instant a buyer signs,
  underwritten by the seller's on-chain reputation.*

### Replaces or supersedes

This section does not replace §4 (Option A remains the narrative frame:
attestation-write is the product). It fills in the **concrete seller-side
perks** that make the attestation stream valuable to demo. If A+B ship, the
pitch upgrades from "here is an attestation pipe" to "here is an attestation
pipe *and the first consumer that turns attestations into real seller
benefits*" — stronger without over-claiming economic mechanism design.

---

## 8. Changelog

- 2026-04-29: Initial draft. Created after founder pushback on the
  seller-premium flip surfaced price-autonomy objection.
- 2026-04-29 (later): Added §7 seller-perk candidates beyond fee
  redirection, after founder asked "what else can the facilitator/gateway
  unlock for sellers besides fee redirection?"
