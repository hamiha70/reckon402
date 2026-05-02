# Reckon402 — ETHGlobal OpenAgents 2026 Submission Draft

> **Status:** DRAFT — for human review before submission.
> `[TODO]` markers remain for items that still require manual input.

---

## 1. One-Paragraph Pitch

Reckon402 is a closed-loop settlement-attestation primitive for agent commerce. Every confirmed x402 payment triggers an ERC-8004 reputation write to the canonical Base registry; every subsequent ENS resolution reads that reputation back to compute a risk-adjusted routing fee. New SellingAgents are unknown counterparties — Reckon402's risk engine demands a premium. As verified on-chain settlement history accumulates, the risk is quantified and the routing fee drops automatically. BuyingAgents pay less not because the seller decided to discount, but because Reckon402's underwriting model updated from on-chain evidence. No competitor closes this loop in production — existing solutions read ERC-8004 but do not write post-settlement. The write side, wired into ENS-resolved x402 routing with SellingAgent-sovereign text records, is what Reckon402 owns.

---

## 2. What It Does

### x402 Facilitator — Real USDC on Base Sepolia

Reckon402 runs a stateful x402 v2 facilitator at `https://facilitator.reckon402.com`. Every payment follows an explicit state machine: `SUBMITTED → PENDING_CONFIRMATION → CONFIRMED → RECONCILED`, with `FAILED` as a sibling terminal. Idempotent retry keys off a deterministic `paymentId = keccak256(eip3009TypedData ‖ nonce)` — replaying the same EIP-3009 authorization twice returns the same `paymentId` and causes no double-spend. Receipts are wire-compatible with the x402 v2 `SettlementResponse` shape and extend it with `paymentId`, `state`, `retryCount`, and `tdErc8004Tx` fields that Reckon402-aware callers can inspect. Real USDC settles on Base Sepolia.

### ERC-8004 Attestation WRITE After Every Settlement

After every `CONFIRMED` payment the facilitator worker writes a `ReputationRegistry` feedback entry tagged `("payment", "x402-settlement")`, linked to the receipt URI and content hash. Writes are idempotent on `(paymentId, agentId)`. The SellingAgent's `x402.attestation` ENS text record controls opt-in; the SellingAgent owns that record under the gateway-enforced ACL — Reckon402 cannot silently disable attestation for a SellingAgent it wants to disadvantage.

### ENS-Resolved Pricing That Reads Reputation Back

The gateway at `https://gateway.reckon402.com` implements EIP-3668 + ENSIP-10 wildcard resolution via `ezccip.js`. The on-chain resolver (`Reckon402Resolver` at `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` on Ethereum Sepolia) encodes `msg.sender` into `callData` (CCIP-Read Pattern A), so vanilla `viem` and `wagmi` clients work without custom code. The gateway decodes the caller, reads the `ReputationRegistry` on Base Sepolia to find the SellingAgent's attestation count, maps that count to a risk tier, and applies Reckon402's risk-adjusted routing fee before returning a signed `x402.amount` record. The demo SellingAgent (`seller.reckon402-test.eth`) has accumulated 14+ attestations and is in the **gold tier**: zero risk premium applied, BuyingAgent pays `85000` (0.0850 USDC). An unknown SellingAgent at the same base price would route at `100000` (0.10 USDC) — the extra 18% is Reckon402's risk fee on an unverified counterparty.

### SellingAgent Onboarding in ~60 Seconds

The onboarding CLI (`just onboard <name> <wallet>`) and the web dashboard at `https://app.reckon402.com` provision a new SellingAgent end-to-end: ENS subname minted (`seller{N}.reckon402-test.eth`), Splitter lockbox deployed via `SplitterFactory`, ERC-8004 `agentId` registered in the `IdentityRegistry`, and ENSIP-25 text records written linking the ENS name to the agentId. The dashboard shows five sequential steps with green checks and Basescan/Etherscan links as each completes — live in ~13 seconds.

### Gateway-Enforced ACL: "The Platform Cannot Turn On You"

ENS text records are split by ownership. **SellingAgent-owned** records — `x402.amount`, `x402.pricing`, `x402.endpoint`, `x402.attestation`, `x402.yield` — require a signature from the subname owner's EOA. **Reckon402-owned** records — `x402.splitter`, `x402.facilitator`, `x402.erc8004.registry`, `x402.erc8004.agent_id` — require a signature from the Reckon402 onboarding EOA. The gateway verifies each write against `registry.owner(namehash)` and per-key ACL. A SellingAgent's pricing and attestation opt-in are cryptographically theirs; Reckon402 cannot front-run pricing or silently reroute payments.

---

## 3. How It's Built

**Smart contracts (Foundry + Solidity 0.8.24):** The `Splitter` contract is a deliberately-minimal immutable BPS-based router — no admin, no upgrade path, no transferable rights. A `getRecipient(slot)` view function leaves a forward-compatibility hook for v2 ERC-1155 revenue-stream tokenization without modifying the audited v1 surface. `SplitterFactory` deploys deterministic instances per SellingAgent via CREATE2. `Reckon402Resolver` is a thin CCIP-Read wrapper that issues `OffchainLookup` with `msg.sender` encoded in `callData`.

**Workers (Cloudflare Workers + D1):** The facilitator, gateway, and onboard-orchestrator each run as Cloudflare Workers. The landing page at `reckon402.com` is a Worker. The frontend at `app.reckon402.com` is served via Workers Assets (vanilla HTML/JS, no framework). D1 stores payment state, ENS text records (the off-chain record store backing the CCIP-Read resolver), and SellingAgent registration. The gateway's signed-write endpoint verifies EOA signatures and enforces the per-key ACL before writing to D1.

**ENS + CCIP-Read:** `reckon402-test.eth` resolves via `Reckon402Resolver` on Ethereum Sepolia using ENSIP-10 wildcard. The gateway implements EIP-3668 via `ezccip.js` (resolverworks/ezccip.js, Cloudflare Workers native). ENSIP-25 text records (`x402.erc8004.registry`, `x402.erc8004.agent_id`) are set at SellingAgent onboarding, creating the canonical ENS↔ERC-8004 binding.

**ERC-8004 integration:** The `@reckon402/erc-8004-client` package reads and writes the canonical `ReputationRegistry` (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) and `IdentityRegistry` (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) on Base Sepolia.

**npm packages (all published `@0.1.0`):**
- `@reckon402/types` — shared TypeScript types for the full Reckon402 stack
- `@reckon402/buyer-sdk` — BuyingAgent wallet + automatic x402 payment negotiation
- `@reckon402/middleware-hono` — Hono middleware: `withX402` · `withReputation` · tier pricing
- `@reckon402/facilitator-client` — client for the Reckon402 Facilitator Worker (settlement + callbacks)

---

## 4. Live Deployments & On-Chain Evidence

- **Landing page:** https://reckon402.com
- **Frontend / onboarding dashboard:** https://app.reckon402.com
- **Smart contract reference:** https://app.reckon402.com/contracts
- **SellingAgent endpoint:** https://agent.reckon402.com
- **Facilitator:** https://facilitator.reckon402.com
- **Gateway:** https://gateway.reckon402.com
- **ENS name:** `seller.reckon402-test.eth` (demo SellingAgent), resolving via CCIP-Read on Ethereum Sepolia
- **Reckon402Resolver (ETH Sepolia):** `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a`
- **SplitterFactory (Base Sepolia):** `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7`
- **IdentityRegistry / ERC-8004 (Base Sepolia):** `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- **ReputationRegistry / ERC-8004 (Base Sepolia):** `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- **seller.reckon402-test.eth Splitter (Base Sepolia):** `0x372c0b951035da05058b175a15b4fe7d29f1fc4c`
- **Demo SellingAgent reputation:** 14+ on-chain attestations → gold tier (15% discount), live price `0.0850 USDC`
- **npm org:** https://www.npmjs.com/org/reckon402

`[TODO: add first live ERC-8004 attestation tx hash — check Basescan for ReputationRegistry.giveFeedback from facilitator EOA]`
`[TODO: add first full-flow settlement tx hash]`

---

## 5. What's Next

### Delivery-Proof: Volume Cap vs Per-Transaction Truth

Today's settlement attestation caps fraud volume. A SellingAgent with a strong on-chain reputation cannot commit unlimited fraud without eventually losing tier status — the attestation count is bounded by paid settlements, and a SellingAgent that delivers nothing eventually stops receiving discounted prices. But attestations do not prove that a specific paid request was correctly delivered; fraud is possible inside the paid set.

Post-hackathon, Reckon402 will close this per-transaction gap via a **BuyingAgent-side delivery-proof SDK** using Reclaim Protocol (`@reclaimprotocol/zk-fetch`) zkTLS. A BuyingAgent that receives a failed or incorrect paid response generates a zkTLS proof of the failure (proof generation runs off the critical settlement path, ~4s, Node ≥18) and submits it post-facto to the facilitator for a negative ERC-8004 attestation against the SellingAgent's `agentId`, or a refund path. This closes the exact gap that settlement-caps leave open: settlement caps fraud *volume*; delivery-proof catches fraud *inside the paid set*.

Note: live zkTLS is not shipping for this hackathon. A feasibility spike (`docs/research/zktls-feasibility.md`) confirmed that proof generation requires a witness to be in the TLS session path — post-facto transcript proofs are claims, not proofs — and the tooling is incompatible with Cloudflare Workers. The post-hackathon path routes proof generation through the BuyingAgent SDK (Node.js), where the constraint does not apply.

### Other Roadmap Items

- **Mainnet deployment:** `reckon402.eth` ENS name and `Reckon402Resolver` on Ethereum mainnet. The full settlement stack (SplitterFactory, ERC-8004 agentId registration, facilitator) remains on Base Sepolia for this demo. Flipping to Base Mainnet requires changing one env var — no code change.
- **Nanopayment batching:** At `$0.10` unit pricing, per-payment gas is acceptable. At sub-cent unit prices, batching N EIP-3009 authorizations into one settlement transaction becomes necessary. Designed as a v1.5 path.
- **Multi-runtime BuyingAgent SDK:** The same `reckon402.pay()` shape ships as `@reckon402/buyer-sdk` (npm/TypeScript). A LangChain toolkit (`langchain-reckon402`, PyPI) and MCP server (`@reckon402/mcp-server`) follow post-hackathon.

---

## 6. Tracks & Prizes

### Primary: ETHGlobal OpenAgents

The core submission. Reckon402 is a settlement-attestation primitive for agent commerce. The demo shows a SellingAgent onboarded in ~60 seconds and a BuyingAgent accumulating reputation across sequential paid calls — on-chain, verifiable, no mocks.

### ENS — Best ENS Integration for AI Agents + Most Creative Use

ENS is not cosmetic here. `seller.reckon402-test.eth` is the SellingAgent's identity and Reckon402's risk-routing oracle simultaneously. The CCIP-Read resolver returns a risk-adjusted `x402.amount` computed from the SellingAgent's live ERC-8004 attestation count — the same ENS name, different routed price, as reputation accumulates. ENSIP-25 text records (`x402.erc8004.registry`, `x402.erc8004.agent_id`) are written at onboarding, creating the ENS↔ERC-8004 canonical binding. The gateway-enforced ACL makes SellingAgent text-record ownership meaningful: the SellingAgent's EOA must sign any write to `x402.amount`, `x402.pricing`, `x402.attestation`, or `x402.endpoint`. The platform cannot change these records without the SellingAgent's key.

### KeeperHub — Best Integration + Builder Feedback Bounty

Reckon402 ships:
- **`@reckon402/kh-skill`** (npm, published `@0.1.0`): a KeeperHub workflow node reference implementation that wraps `@reckon402/buyer-sdk`. Demonstrates Focus Area 2 (Payments) — KeeperHub workflows paying x402-priced APIs autonomously.
- **`recipes/kh-workflow.json`**: A workflow JSON recipe showing three sequential paid calls to `agent.reckon402.com/research`, demonstrating the reputation-growth loop (0% → 5% → 10% → 15% discount as attestations accumulate).

**Builder Feedback (`FEEDBACK.md`):** Four concrete gaps found while integrating KeeperHub:
1. In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows. We built around it with an AWS Lambda + KMS signing wrapper (`signing.reckon402.com`); a first-party KH signing primitive would make this a one-line integration.
2. ERC-8004 endpoint not yet live (404 at `app.keeperhub.com/.well-known/erc8004.json`); we read the canonical Base registry directly.
3. Payment receipt loop is fire-and-forget today; a built-in `wait_for_receipt(paymentId)` step would close the loop without custom polling logic.
4. Documentation gap on the BuyingAgent side; existing examples are SellingAgent/merchant-side. We contribute `recipes/kh-workflow.json` + workflow description.

---

## 7. Team & Contact

`[TODO: fill in team member names, Telegram handles, X/Twitter handles]`

- **GitHub:** https://github.com/hamiha70/reckon402
- **Live Demo:** https://app.reckon402.com
- **Landing:** https://reckon402.com
- **Facilitator:** https://facilitator.reckon402.com
- **Gateway:** https://gateway.reckon402.com
- **npm:** https://www.npmjs.com/org/reckon402

---

## Review Checklist Before Submitting

- [x] `app.reckon402.com` frontend is live (Workers Assets + onboard-orchestrator)
- [x] `reckon402.com` landing page live (Workers, redesigned with logo + arch diagram)
- [x] `app.reckon402.com/contracts` smart contract reference page live
- [x] 4 npm packages published: `@reckon402/types`, `@reckon402/buyer-sdk`, `@reckon402/middleware-hono`, `@reckon402/facilitator-client`
- [x] `just test-e2e` (full-flow-l4b) passes green — settlement + ERC-8004 attestation loop confirmed
- [x] `just onboard` works in ~13s — 5/5 steps clean
- [ ] Add team names + contact handles to Section 7
- [ ] Add first live attestation tx hash to Section 4
- [ ] Add first full-flow settlement tx hash to Section 4
- [ ] Retake all 5 screenshots (landing page changed; screenshot 5 shows bare JSON)
- [ ] Record demo video (2:00–4:00 per ETHGlobal requirements); attach link
- [ ] Confirm live `x402.amount` via gateway and update Section 4 numbers if changed
- [ ] Verify all Base Sepolia tx hashes still indexed on Basescan
