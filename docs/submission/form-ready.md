# Reckon402 — ETHGlobal Submission Form (Copy/Paste Ready)

> Maps 1:1 to the ETHGlobal OpenAgents 2026 submission form fields
> shown in the captured screenshots. Each section header below
> matches the form field label exactly. Char counts annotated.
>
> **Status:** ready for paste. Pre-video build of `seller22` and any
> live-tx hashes captured during recording can optionally update
> the GitHub Repositories / Description sections post-recording.

---

## Page 1 — Project details

### Project name
```
Reckon402
```

### Category
```
Wallet/Payments
```
*(already correct in the form)*

### Emoji
Suggested: 🪙 OR ✅ OR 🧠 (you have a check-mark glyph variant in your form already)

### Demo URL
```
https://app.reckon402.com
```
*(swap from `www.reckon402.com` — `app.reckon402.com` is the live demo dashboard; `reckon402.com` is the marketing landing.)*

### Short description (max 100 chars)

Pick whichever lands best — all under 100:

| Variant | Chars |
|---------|-------|
| `Agent commerce with memory. x402 settlements write ERC-8004; ENS routes per-agent Escrow.` | 89 |
| `x402 settlements write ERC-8004 attestations. ENS resolves the per-agent Escrow tier.` | 86 |
| `Agent commerce with memory: x402 + ERC-8004 attestations + ENS-routed on-chain Escrow.` | 87 |

**Recommended:** the first one (it's the most pitch-y, leads with the tagline).

### Description (min 280 chars)

```
Reckon402 closes the first loop in agent commerce. Every confirmed
x402 payment writes a facilitator-signed ERC-8004 reputation
attestation on-chain. Every ENS resolution reads it back through
CCIP-Read. The trust signal drives a per-agent on-chain Escrow:
each settlement deposits 10% into the agent's NFT-bound Escrow,
and a pluggable ITierStrategy releases the held buffer back to
the seller as the on-chain attestation count grows. Buyer-facing
price stays constant; what changes is how much of the buffer the
seller can withdraw. Same ENS name, different escrow tier as
reputation accumulates.
```
(629 chars)

### How it's made (min 280 chars)

```
Solidity 0.8.24 + Foundry. Splitter, EscrowFactory, and
LinearMonotonicTierStrategy are minimal immutable contracts —
CREATE2-deterministic per-agent deploys, BPS-immutable, no admin,
no upgrade path. Foundry fork tests gate against the live ERC-8004
contracts on Base Sepolia.

Cloudflare Workers + Hono for everything off-chain: agent
(x402 paywall), facilitator (verify + settle + attestation write),
gateway (CCIP-Read + ENSIP-25 + ERC-8004 reads), onboard-orchestrator
(6-step provisioning), landing (reckon402.com + /ens + /keeperhub).
D1 (SQLite) for receipts, ENS records, and SellingAgent state.

ENS via ezccip.js with msg.sender encoded into callData (CCIP-Read
Pattern A) — vanilla viem and wagmi clients work without custom code.
EOA-grade EIP-712 signing for x402 PaymentAuthorizations is offloaded
to AWS Lambda + KMS (signing.reckon402.com), since browser/sandbox
typed-data signing is unreliable.

5 npm packages at @0.1.0: types, buyer-sdk, middleware-hono,
facilitator-client, erc-8004-client. KH workflow + skill bundle
ship as the autonomous-buyer reference. Solo author over the
hackathon window.
```
(1180 chars)

### GitHub Repositories
- Owner: `hamiha70`
- Primary: `hamiha70/reckon402` (Monorepo) ✓ already set

---

## Page 2 — Images

### Logo (square 512x512)

**Action needed.** Use the green check-on-stripes glyph that's already
the favicon/header logo on `reckon402.com`. Source SVG is inline in
`workers/landing/index.js` (constant `LOGO_SVG`). Export at 512×512
PNG against the dark background `#030712` to match the rest of the
brand.

Quick cmd to render (needs `rsvg-convert` or open in browser + screenshot):
```
# extract the SVG, paste into a file logo.svg, then:
rsvg-convert -w 512 -h 512 -b '#030712' logo.svg -o logo-512.png
```

### Cover image (16:9 640×360)

**Already uploaded** — the green Reckon402 banner with the architecture
diagram preview. Looks good. ✓

### Screenshots — recommended 6

The form requires minimum 3, supports 6. Ranked by narrative impact —
take the top 3 if you only have time for the minimum.

| Slot | Screenshot | Source URL | What it shows | Priority |
|------|-----------|------------|---------------|----------|
| 1 | **Landing hero + architecture** | `reckon402.com` (top fold + scroll to "Architecture" twin-box) | The pitch + the closed loop in one image | MUST |
| 2 | **Onboard form filled** | `app.reckon402.com/#/` after typing | Six form fields + Escrow toggle ON + immutable splitter recipients table visible | MUST |
| 3 | **Onboarding progress panel** | `app.reckon402.com/#/` mid-flow (capture between step 4 and step 6) | Six green checkmarks + per-step elapsed times + Etherscan/Basescan links | MUST |
| 4 | **Dashboard — fresh Escrow + tier table** | `app.reckon402.com/#/agent/seller22.reckon402-test.eth` after onboarding | Header (price, agentId, splitter, escrow), ENS records expanded, Escrow panel showing T0 / 0 attestations / 0 withdrawable | nice |
| 5 | **Dashboard — post paid call** | Same dashboard after clicking Run Test Call (3 calls in a row) | Recent paid calls table with settle/distribute/attest tx links, attestationCount = 3, tier walked to T1+ | nice |
| 6 | **Claim All result** | Same dashboard after clicking Connect Wallet → Claim All | Withdraw status with claim tx hash + amount withdrawn | nice |

**Cover-the-prize tracks bonus alternative for slot 6:**
A screenshot of `reckon402.com/keeperhub` with the live KH workflow
tile visible — proves the KH integration is actually deployed,
not just shipped as code.

### Capture-during-recording trick

If you're recording the screen anyway for the demo video, pause it
at the right beat and screenshot from that frame instead of running
the flow twice. Faster + guarantees the screenshots are temporally
consistent with the video.

---

## Page 3 — Tech Stack

> ⚠️ **Three corrections needed in your filled form.** The rest is correct.

### Ethereum developer tools (already correct)
✓ Alchemy · ✓ Foundry · ✓ ethers.js *(actually we use viem, not ethers — see correction below)*

**Correction:** swap `ethers.js` → `viem` if the form has a viem option (most ETHGlobal forms do). If not, leave ethers.js — it's close enough. **Add Hardhat-style alternative: none of our code uses ethers.js directly; we use viem via the buyer-sdk and middleware-hono packages.**

### Blockchain networks

⚠️ **Currently shows `Base, 0G` — `0G` is wrong.** We do not use 0G anywhere.

**Correct value:**
- ✓ Base
- ✓ Ethereum *(for the ENS registry on Sepolia)*
- Remove `0G`

### Programming languages (already correct)
✓ Bash/Shell · ✓ HTML/CSS · ✓ Node.js · ✓ Solidity · ✓ TypeScript

### Web frameworks

⚠️ **Currently shows `Express, Next.js` — both wrong.** We don't use either.

**Correct value:**
- Remove `Express`
- Remove `Next.js`
- Add `Hono` (we use Hono on Cloudflare Workers for every route handler)
- If `Hono` isn't in the dropdown, leave the field empty or pick the nearest equivalent and add `Hono` in the free-text "other technologies" field below.

### Databases

⚠️ **Currently shows `None` — wrong.** We use Cloudflare D1 (SQLite) extensively.

**Correct value:**
- Remove `None`
- Add `Cloudflare D1` if available, otherwise `SQLite`
- If neither is in the dropdown, add it via the "other technologies" free-text field.

### Design tools
✓ `None` is correct — no Figma/Sketch artefacts in the repo.

### Other technologies (free-text, type and Enter)

Add these — they don't fit the structured categories above:

```
Hono
Cloudflare D1
Cloudflare Workers
AWS Lambda
AWS KMS
ENS
ENSIP-25
CCIP-Read
EIP-3009
EIP-712
ERC-8004
x402 v2
Vitest
```

### AI tools

✓ Already filled in. Optional small tightening:

```
Cursor (Composer 2, Opus 4.7, Sonnet 4.6) and Claude Code throughout
the build — Cursor for evaluating design alternatives and structural
refactors, Claude Code for green-field code generation and inline
test authoring. All commits and KH workflow definitions are
human-authored and human-reviewed; AI was the implementation force-
multiplier, not a decision-maker.
```

---

## Page 4 — Prizes

### Selected prizes
✓ ENS — $5,000 *(actually 2 × $2,500 sub-prizes; see below)*
✓ KeeperHub — $5,000 *(actually $4,500 main + $500 bounty; see below)*

*(Two partners selected — limit is 3. **Recommendation: do not add a 3rd.** The remaining options (0G, Uniswap, Gensyn AXL) all require integrations we don't ship. A stretch claim hurts credibility on the two strong fits we do have.)*

---

### Prize structure (per the OpenAgents 2026 prize page)

**ENS — $5,000 total = TWO independent sub-prizes of $2,500 each:**
- **Best ENS Integration for AI Agents** — $2,500 (1st $1,250 / 2nd $750 / 3rd $500)
- **Most Creative Use of ENS** — $2,500 (1st $1,250 / 2nd $750 / 3rd $500)

The form likely surfaces ENS as one $5,000 row, but Reckon402 qualifies for **both** independent sub-prizes. The justification field below explicitly hits both qualification descriptions.

**KeeperHub — $5,000 total = TWO independent prizes:**
- **Best Use of KeeperHub** — $4,500 (1st $2,500 / 2nd $1,500 / 3rd $500)
  - Two ranked focus areas in one pool: (1) Innovative use, (2) Integration. Reckon402 hits **Focus Area 2: Payments** — KH workflows paying x402-priced APIs autonomously.
- **Builder Feedback Bounty** — $500 (up to 2 teams × $250)
  - Independent of placement in the main pool. Reckon402 ships `FEEDBACK.md` covering all four eligible categories (UX friction, reproducible bugs, doc gaps, feature requests).

---

### ENS — How are you using this Protocol/API?

> Covers both sub-prizes: identity-for-AI-agents AND most-creative-use.

```
Reckon402 uses ENS in two complementary ways, hitting both ENS prize
sub-tracks:

(1) Best ENS Integration for AI Agents — identity that does real work.
Each SellingAgent gets a wildcard subname under reckon402-test.eth
(seller{N}.reckon402-test.eth), served by Reckon402Resolver on
Ethereum Sepolia via EIP-3668 CCIP-Read with msg.sender encoded into
callData (Pattern A) — so vanilla viem and wagmi clients resolve
without any Reckon402-specific code. The ENS name resolves: the
agent's HTTPS endpoint (x402.endpoint), the price (x402.amount), the
on-chain Splitter and Escrow (x402.splitter, x402.escrow), the
ERC-8004 agentId (x402.erc8004.agent_id), and the gateway-enforced
ACL distinguishes which keys the SellingAgent owns vs which Reckon402
owns. ENS is doing real work: identity, discovery, payment routing,
and access control.

(2) Most Creative Use of ENS — ENS as the dynamic anchor for
on-chain Escrow tier behavior. The same ENS name returns a different
"released BPS" as on-chain reputation accumulates. Each paid
settlement writes a facilitator-signed ERC-8004 attestation; the
next CCIP-Read resolution reads the attestation count live, passes
it through a pluggable ITierStrategy contract, and recomputes the
per-agent Escrow's withdrawable amount on the fly. ENSIP-25 text
records create a canonical ENS↔ERC-8004↔Escrow binding at
onboarding — a wallet-name becomes a reputation-driven coordination
mechanism for funds custody. Buyer-facing price stays constant; what
the ENS name resolves into the world changes as the agent earns it.

Live demo: https://app.reckon402.com (no hard-coded values; every
record is on-chain and CCIP-Read resolved at request time).
Track page with full evidence: https://reckon402.com/ens
```

### ENS — Link to the line of code where the tech is used

```
https://github.com/hamiha70/reckon402/blob/main/contracts/src/Reckon402Resolver.sol
```

*(Alternative if they want the gateway-side resolver implementation:
`https://github.com/hamiha70/reckon402/blob/main/workers/gateway/src/index.ts`)*

### ENS — Difficulty rating (1-10)

**Recommended: 7** — CCIP-Read with msg.sender in callData (Pattern A) is well-specified but actual implementations are sparse; ezccip.js helped a lot.

### ENS — Additional feedback for ENS

```
ENSIP-25 text-record naming is excellent for our use case but the
ecosystem doesn't yet have a registry of "well-known" x402-related
key conventions — we invented x402.escrow, x402.splitter,
x402.erc8004.* on our own. A community-maintained list of
recommended keys (or a simple namespace registry) would let
multiple x402 facilitators converge on a shared vocabulary.

Documentation gap on the developer-facing side of CCIP-Read: there
are good ezccip docs and good resolverworks docs, but a single
"here's how to set up a wildcard subname resolver in 30 minutes"
guide does not exist. We figured it out from reading the spec and
testing against viem — would have saved us a day if there was a
worked example wired end-to-end on Cloudflare Workers.
```

---

### KeeperHub — How are you using this Protocol/API?

> Covers both KH prizes: Best Use of KeeperHub (Focus Area 2: Payments) AND Builder Feedback Bounty.

```
Reckon402 applies for both KH prizes in this submission:

(1) Best Use of KeeperHub — Focus Area 2: Payments. Reckon402 ships
a live, public KeeperHub workflow that uses the Reckon402 stack as
an autonomous x402 buyer end-to-end:
  https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9
The workflow trigger hits agent.reckon402.com/research; the
@reckon402/buyer-sdk negotiates the x402 paywall (HTTP 402 →
PaymentRequirements); the signing wrapper at signing.reckon402.com
produces the EIP-712-signed transferWithAuthorization (workaround
for KH's in-sandbox typed-data limitation; KMS-custodied buyer
key in eu-central-1); the facilitator settles on Base Sepolia,
deposits 10% into the agent's per-agent Escrow, and writes a
facilitator-signed ERC-8004 attestation. The same workflow definition
is shipped as a one-file recipe (recipes/kh-workflow.json) plus a
skill bundle (@reckon402/kh-skill) so any KH user can drop it into
their account and run. Depth of integration: KH-native trigger,
KH-native HTTP step, KH-native conditional, KH-native artifact
output — no glue scripts, no external orchestrator. KH is the
buyer; Reckon402 is the rails.

(2) Builder Feedback Bounty. We hit all four eligible categories
(UX/UI friction, reproducible bugs, doc gaps, feature requests) with
specific actionable items and proposed primitives — not vague
praise. Full feedback in the dedicated section below and in
FEEDBACK.md at the repo root.

Track page with full evidence + four-gap builder feedback:
https://reckon402.com/keeperhub
```

### KeeperHub — Link to the line of code where the tech is used

```
https://github.com/hamiha70/reckon402/blob/main/recipes/kh-workflow.json
```

*(Alternative: the kh-skill package — `https://github.com/hamiha70/reckon402/tree/main/packages/kh-skill`)*

### KeeperHub — Difficulty rating (1-10)

**Recommended: 5** — KH itself is straightforward but in-sandbox EIP-712 typed-data signing was a hard blocker that forced us to deploy AWS Lambda + KMS as a workaround.

### KeeperHub — Additional feedback for KeeperHub

(Same four-gap feedback that's in `FEEDBACK.md` — paste the four headers,
or copy the longer-form version below.)

```
Four concrete gaps from shipping a KH workflow that drives an
autonomous x402 buyer end-to-end:

1. In-sandbox EIP-712 typed-data signing is a hard blocker for x402
   buyer flows. KH's documented Turnkey + Direct Execution surface
   handles on-chain transactions but not arbitrary EIP-712 typed-data
   destined for HTTP bodies. We deployed AWS Lambda + KMS as a
   workaround at signing.reckon402.com/sign. A first-party KH-built
   Turnkey policy that produces signed typed-data without leaving
   the sandbox would turn x402 + KH into a one-line integration.

2. ERC-8004 endpoint isn't shipped. app.keeperhub.com/.well-known/
   erc8004.json, /agent.json, and /agent all returned 404 during
   our 2026-04-24 verification pass. We read the canonical Base
   Sepolia ReputationRegistry directly via @reckon402/erc-8004-client.
   A first-party KH wrapper around ERC-8004 reads would let workflows
   do reputation-aware execution without external chain reads.

3. Payment receipt loop is fire-and-forget. PR #822 added payer
   tracking + protocol/chain columns, but a built-in
   wait_for_receipt(paymentId) step that polls a configured
   facilitator's /receipt endpoint until terminal state would close
   the loop without custom polling logic. Reckon402's facilitator
   already exposes GET /x402/receipt/:paymentId; a built-in KH
   primitive that wraps this pattern would generalise to any x402
   facilitator.

4. Documentation gap on the buyer side. Existing examples are
   mostly merchant-side (PRs #818, #821, #822, #835, #837, #840).
   An end-to-end "KH workflow as autonomous x402 buyer" worked
   example would have saved us several hours. We submit
   recipes/kh-workflow.json + @reckon402/kh-skill as a contribution
   toward this gap.

Full FEEDBACK.md: https://github.com/hamiha70/reckon402/blob/main/FEEDBACK.md
```

---

## Page 5 — Video

(Form not shown in screenshots. Standard ETHGlobal video upload
form expects a YouTube/Loom/Vimeo URL.)

Recording target: fresh `seller22.reckon402-test.eth` — script in
`docs/demo-voiceover.md`. ~3:00 total length. Hit-record-and-go from
the live `app.reckon402.com` form prefilled with `seller22` + `0.01 USDC`.

---

## Page 6 — Future

(Form not shown in screenshots; usually a freeform "what's next" field.)

Suggested copy:

```
Buyer-side proof-of-non-delivery via Reclaim Protocol zkTLS.
A BuyingAgent that receives a failed paid response generates a
zkTLS proof of the failure (off the critical settlement path,
~4s, Node ≥18) and submits it to the facilitator, which writes
a NEGATIVE ERC-8004 attestation against the SellingAgent's agentId
and unlocks Escrow withdrawal back to the buyer for the disputed
amount. This closes the gap that settlement caps leave open:
settlement caps fraud volume; delivery-proof catches fraud inside
the paid set.

Other history-aware adaptations drop in directly because they're
consumer-side, not protocol-side: tier-aware pricing strategies
(seller's choice), risk-weighted routing across multiple sellers,
optimistic-vs-strict service handling, investable-agent revenue
claims via ERC-1155 tokenisation of Splitter recipient slots.

Mainnet cutover from Base Sepolia is one env-var change — the
contracts and infrastructure are unchanged.
```

---

## Page 7 — Final

(Standard ETHGlobal "review and submit" — no content needed.)

---

## TL;DR — only 3 things that need YOUR action before submit

1. **Fix Tech Stack form**: remove `0G` (networks), remove
   `Express` + `Next.js` (web frameworks), remove `None` (databases).
   Add `Hono` and `Cloudflare D1` (or via the "other technologies"
   free-text field).
2. **Take the 3 mandatory screenshots** during the demo recording
   (slots 1–3 in the table above are the must-haves).
3. **Logo at 512×512** — the SVG is in `workers/landing/index.js`
   (constant `LOGO_SVG`); export at 512×512 PNG with `#030712` background.
