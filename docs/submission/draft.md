# Reckon402 — ETHGlobal OpenAgents 2026 Submission Draft

> **Status:** DRAFT — for human review before submission.
> `[TODO]` markers remain for items that still require manual input.

---

## 1. One-Paragraph Pitch

Reckon402 closes the first loop in agent commerce. Every confirmed x402 payment writes an ERC-8004 reputation attestation, signed by the facilitator, on-chain. Every subsequent ENS resolution reads that history back through CCIP-Read and returns a **trust signal** — a verifiable count of past settlements between the same parties. Downstream code can bind that signal to any history-aware behavior: tier-adjusted price, risk-weighted routing, optimistic-vs-strict service handling, investable-agent revenue claims. For this hackathon Reckon402 picks the single most consistently underbuilt behavior — **claims and revocation after settlement** — and instantiates it as a per-agent on-chain Escrow with a pluggable, parameterized tier curve. A portion of every payment flows into the SellingAgent's Escrow; the release schedule is parameterized by the same trust signal — low reputation holds a large buffer against future claims, high reputation releases most of the payment immediately. Funds are NFT-bound to the agent's IdentityRegistry token, so the buffer transfers with ownership.

---

## 2. What It Does

### x402 Facilitator — Real USDC on Base Sepolia

Reckon402 runs a stateful x402 v2 facilitator at `https://facilitator.reckon402.com`. Every payment follows an explicit state machine: `SUBMITTED → PENDING_CONFIRMATION → CONFIRMED → RECONCILED`, with `FAILED` as a sibling terminal. Idempotent retry keys off a deterministic `paymentId = keccak256(eip3009TypedData ‖ nonce)` — replaying the same EIP-3009 authorization twice returns the same `paymentId` and causes no double-spend. Receipts are wire-compatible with the x402 v2 `SettlementResponse` shape and extend it with `paymentId`, `state`, `retryCount`, and `tdErc8004Tx` fields that Reckon402-aware callers can inspect. Real USDC settles on Base Sepolia.

### ERC-8004 Attestation WRITE After Every Settlement

After every `CONFIRMED` payment the facilitator worker writes a `ReputationRegistry` feedback entry tagged `("payment", "x402-settlement")`, linked to the receipt URI and content hash. Writes are idempotent on `(paymentId, agentId)`. The SellingAgent's `x402.attestation` ENS text record controls opt-in; the SellingAgent owns that record under the gateway-enforced ACL — Reckon402 cannot silently disable attestation for a SellingAgent it wants to disadvantage.

### ENS-Resolved Pricing That Reads Reputation Back

The gateway at `https://gateway.reckon402.com` implements EIP-3668 + ENSIP-10 wildcard resolution via `ezccip.js`. The on-chain resolver (`Reckon402Resolver` at `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` on Ethereum Sepolia) encodes `msg.sender` into `callData` (CCIP-Read Pattern A), so vanilla `viem` and `wagmi` clients work without custom code. The gateway decodes the caller, reads the `ReputationRegistry` on Base Sepolia to find the SellingAgent's attestation count, and returns it as a signed `x402.amount` record. That count is the trust signal: downstream of the gateway it drives the SellingAgent's per-agent on-chain Escrow release schedule via a pluggable `ITierStrategy`. The v1 default `LinearMonotonicTierStrategy` ships thresholds `[0, 1, 3, 10, 30, 100, 300, 1000]` and release BPS `[0, 500, 1500, 3000, 5000, 7000, 8500, 10000]`. The demo SellingAgent (`seller11.reckon402-test.eth`) has accumulated 5 on-chain attestations and sits at tier T2 with `releasedBps = 1500`.

### SellingAgent Onboarding in ~60 Seconds

The onboarding CLI (`just onboard-l4d <name> <wallet>`) and the web dashboard at `https://app.reckon402.com` provision a new SellingAgent end-to-end: ENS subname minted (`seller{N}.reckon402-test.eth`), Splitter lockbox deployed via `SplitterFactory`, per-agent Escrow deployed via `EscrowFactory` at the predicted CREATE2 address, ERC-8004 `agentId` registered in the `IdentityRegistry`, and ENSIP-25 text records (`x402.splitter`, `x402.escrow`, `x402.erc8004.agent_id`, `x402.erc8004.registry`) written linking the ENS name to the on-chain anchors. The dashboard shows six sequential steps with green checks and Basescan/Etherscan links as each completes. The legacy 5-step path (`just onboard`) is preserved for pre-Escrow flows; `just onboard-l4d` is the canonical L4d demo flow used to provision `seller11.reckon402-test.eth`.

### Gateway-Enforced ACL: "The Platform Cannot Turn On You"

ENS text records are split by ownership. **SellingAgent-owned** records — `x402.amount`, `x402.pricing`, `x402.endpoint`, `x402.attestation`, `x402.yield` — require a signature from the subname owner's EOA. **Reckon402-owned** records — `x402.splitter`, `x402.facilitator`, `x402.erc8004.registry`, `x402.erc8004.agent_id` — require a signature from the Reckon402 onboarding EOA. The gateway verifies each write against `registry.owner(namehash)` and per-key ACL. A SellingAgent's pricing and attestation opt-in are cryptographically theirs; Reckon402 cannot front-run pricing or silently reroute payments.

### Per-Agent On-Chain Escrow (NFT-Bound)

Each SellingAgent gets a dedicated Escrow contract deployed via `EscrowFactory` (`0xb06998682bd716e0864257b3ac3aa1fc4cc64589`), keyed by `agentId`. The Splitter routes 87% of every payment to the seller, 3% to the facilitator, and 10% to the agent's Escrow. The Escrow holds those funds and releases them on a schedule parameterized by the agent's on-chain attestation count — read live from `ReputationRegistry` through a single `STATICCALL`, filtered by a pinned `(facilitatorClient, "payment", "x402-settlement")` triple. Sybil cost on the tier signal collapses to compromising the facilitator's KMS-resident signing key (`0x0A0228…c455`); the EVM cannot lie about `msg.sender`.

The release schedule is a pluggable `ITierStrategy` contract. v1 ships `LinearMonotonicTierStrategy` (`0xc498155bc4a2e4ba979ad5797298107c63b26c4e`) with thresholds `[0, 1, 3, 10, 30, 100, 300, 1000]` and release BPS `[0, 500, 1500, 3000, 5000, 7000, 8500, 10000]`. The strategy lives in its own contract; different agents can be wired to different strategies, and curves can be hot-swapped with a new Escrow deploy without touching the Escrow source.

`Escrow.withdrawAll()` gates on `IdentityRegistry.ownerOf(agentId) == msg.sender`, so accumulated funds follow the agent's NFT around an ownership transfer. The seller payout slot in the Splitter is intentionally NOT NFT-bound — it forwards immediately at `distribute()` time and the seller has already chosen their custody. Hold-vs-forward is the load-bearing distinction (rationale in `docs/trust-architecture.md` §4).

The seller11 demo proves the loop end-to-end: 5 paid calls × 0.01 USDC → 5 facilitator-signed attestations on-chain → tier walks from T0 to T2 → `releasedBps` walks from 0 to 1500 → 750 atomic released → seller claims via wallet `withdrawAll()` and receives the 750 atomic on-chain (claim tx `0x5c92bb43…`). Three Foundry fork tests (gated `L4D_FORK_TEST=1`) exercise this path against the live Base Sepolia ERC-8004 contracts: fresh-deploy + 10-feedback tier walk, non-owner revert, and read-only sanity on the deployed seller11 Escrow.

---

## 3. How It's Built

**Smart contracts (Foundry + Solidity 0.8.24):** The `Splitter` contract is a deliberately-minimal immutable BPS-based router — no admin, no upgrade path, no transferable rights. A `getRecipient(slot)` view function leaves a forward-compatibility hook for v2 ERC-1155 revenue-stream tokenization without modifying the audited v1 surface. `SplitterFactory` deploys deterministic instances per SellingAgent via CREATE2. `Reckon402Resolver` is a thin CCIP-Read wrapper that issues `OffchainLookup` with `msg.sender` encoded in `callData`.

**Workers (Cloudflare Workers + D1):** The facilitator, gateway, and onboard-orchestrator each run as Cloudflare Workers. The landing page at `reckon402.com` is a Worker. The frontend at `app.reckon402.com` is served via Workers Assets (vanilla HTML/JS, no framework). D1 stores payment state, ENS text records (the off-chain record store backing the CCIP-Read resolver), and SellingAgent registration. The gateway's signed-write endpoint verifies EOA signatures and enforces the per-key ACL before writing to D1.

**ENS + CCIP-Read:** `reckon402-test.eth` resolves via `Reckon402Resolver` on Ethereum Sepolia using ENSIP-10 wildcard. The gateway implements EIP-3668 via `ezccip.js` (resolverworks/ezccip.js, Cloudflare Workers native). ENSIP-25 text records (`x402.erc8004.registry`, `x402.erc8004.agent_id`) are set at SellingAgent onboarding, creating the canonical ENS↔ERC-8004 binding.

**ERC-8004 integration:** The `@reckon402/erc-8004-client` package reads and writes the canonical `ReputationRegistry` (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) and `IdentityRegistry` (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) on Base Sepolia.

**npm packages (all shipped at `@0.1.0`):**
- `@reckon402/types` — shared TypeScript types for the full Reckon402 stack
- `@reckon402/buyer-sdk` — BuyingAgent wallet + automatic x402 payment negotiation
- `@reckon402/middleware-hono` — Hono middleware: `withX402` · `withReputation` · tier pricing
- `@reckon402/facilitator-client` — client for the Reckon402 Facilitator Worker (settlement + callbacks)
- `@reckon402/erc-8004-client` — typed read/write client for ERC-8004 IdentityRegistry + ReputationRegistry (Base Sepolia + Base Mainnet, used by the facilitator + gateway)

---

## 4. Live Deployments & On-Chain Evidence

- **Landing page:** https://reckon402.com
- **Frontend / onboarding dashboard:** https://app.reckon402.com
- **Smart contract reference:** https://app.reckon402.com/contracts
- **SellingAgent endpoint:** https://agent.reckon402.com
- **Facilitator:** https://facilitator.reckon402.com
- **Gateway:** https://gateway.reckon402.com
- **ENS name:** `seller11.reckon402-test.eth` (demo SellingAgent), resolving via CCIP-Read on Ethereum Sepolia
- **Reckon402Resolver (ETH Sepolia):** `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a`
- **SplitterFactory (Base Sepolia):** `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7`
- **IdentityRegistry / ERC-8004 (Base Sepolia):** `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- **ReputationRegistry / ERC-8004 (Base Sepolia):** `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- **seller11.reckon402-test.eth Splitter (Base Sepolia):** `0x9fc28c71a539645bECc6bEd26288a8e097AD17Eb`
- **EscrowFactory v1 (Base Sepolia):** `0xb06998682bd716e0864257b3ac3aa1fc4cc64589`
- **LinearMonotonicTierStrategy v1 (Base Sepolia):** `0xc498155bc4a2e4ba979ad5797298107c63b26c4e` — thresholds `[0, 1, 3, 10, 30, 100, 300, 1000]`, release BPS `[0, 500, 1500, 3000, 5000, 7000, 8500, 10000]`
- **seller11 per-agent Escrow (Base Sepolia):** `0x863d2105B57Cb98129B68b934FF5708DC9432aAA` — agentId `5423`, NFT-bound to `0xD53ffac42496d73B3Faf946786688a8454F57b1f`
- **Demo SellingAgent reputation:** 5 on-chain attestations → T2 tier (`releasedBps = 1500`); the count is the trust signal driving the per-agent Escrow release schedule
- **First on-chain claim tx (`Escrow.withdrawAll()`):** `0x5c92bb439abe5d2a831f4b279997bbf383aff93d9ade376d3d15c95aaa2c820a` — released 750 atomic (`0.000750 USDC`) to the seller after the tier walked to T2
- **npm org:** https://www.npmjs.com/org/reckon402
- **First live ERC-8004 attestation tx (Base Sepolia):** `0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2`
- **First live x402 settlement tx (Base Sepolia, transferWithAuthorization):** `0xce89c9c68ce24ffe32015db6ec5c9458c97998464aa5af6300b0e3b599667b5b`

---

## 5. Built / What's Next

**Built in this hackathon.** Facilitator-signed ERC-8004 attestations on every settlement; CCIP-Read ENS gateway returning the trust count; per-agent SplitterFactory + Escrow with a pluggable, parameterized tier curve; NFT-bound withdraw; fork-tested against live ERC-8004 contracts on Base Sepolia.

**To be built after.** Buyer-side proof-of-non-delivery (zkTLS via Reclaim Protocol on the buyer SDK) that triggers a negative attestation and unlocks Escrow withdrawal back to the buyer. Other history-aware adaptations — pure tier pricing, risk-weighted routing, optimistic-vs-strict handling, investable-agent revenue claims — drop in directly; they're consumer-side, not protocol-side. The orthogonal problem space (privacy + batching + sub-cent economics) belongs to a different solution vector and is out of scope for Reckon402.

### Delivery-Proof: Volume Cap vs Per-Transaction Truth

Today's settlement attestation caps fraud volume. A SellingAgent with a strong on-chain reputation cannot commit unlimited fraud without eventually losing tier status — the attestation count is bounded by paid settlements, and a SellingAgent that delivers nothing eventually stops accumulating the trust signal that downstream consumers read. But attestations do not prove that a specific paid request was correctly delivered; fraud is possible inside the paid set.

Post-hackathon, Reckon402 closes this per-transaction gap via a **BuyingAgent-side delivery-proof SDK** using Reclaim Protocol (`@reclaimprotocol/zk-fetch`) zkTLS. A BuyingAgent that receives a failed or incorrect paid response generates a zkTLS proof of the failure (proof generation runs off the critical settlement path, ~4s, Node ≥18) and submits it post-facto to the facilitator. The facilitator writes a **negative ERC-8004 attestation** against the SellingAgent's `agentId`, which **unlocks Escrow withdrawal back to the buyer** for the disputed amount. This closes the exact gap that settlement-caps leave open: settlement caps fraud *volume*; delivery-proof catches fraud *inside the paid set*.

Note: live zkTLS is not shipping for this hackathon. A feasibility spike (`docs/research/zktls-feasibility.md`) confirmed that proof generation requires a witness to be in the TLS session path — post-facto transcript proofs are claims, not proofs — and the tooling is incompatible with Cloudflare Workers. The post-hackathon path routes proof generation through the BuyingAgent SDK (Node.js), where the constraint does not apply.

### Other roadmap items

- **Mainnet deployment:** `reckon402.eth` ENS name and `Reckon402Resolver` on Ethereum mainnet. The full settlement stack (SplitterFactory, EscrowFactory, ERC-8004 agentId registration, facilitator) remains on Base Sepolia for this demo. Flipping to Base Mainnet requires changing one env var — no code change.
- **Multi-runtime BuyingAgent SDK:** The same `reckon402.pay()` shape ships as `@reckon402/buyer-sdk` (npm/TypeScript). A LangChain toolkit (`langchain-reckon402`, PyPI) and MCP server (`@reckon402/mcp-server`) follow post-hackathon.

---

## 6. Tracks & Prizes

### Primary: ETHGlobal OpenAgents

The core submission. Reckon402 is a settlement-attestation primitive for agent commerce. The demo shows a SellingAgent onboarded in ~60 seconds and a BuyingAgent accumulating reputation across sequential paid calls — on-chain, verifiable, no mocks.

### ENS — Best ENS Integration for AI Agents + Most Creative Use

ENS is not cosmetic here. `seller11.reckon402-test.eth` is the SellingAgent's identity and Reckon402's risk-routing oracle simultaneously. The CCIP-Read resolver returns a risk-adjusted `x402.amount` computed from the SellingAgent's live ERC-8004 attestation count — the same ENS name, different routed price, as reputation accumulates. ENSIP-25 text records (`x402.erc8004.registry`, `x402.erc8004.agent_id`) are written at onboarding, creating the ENS↔ERC-8004 canonical binding. The gateway-enforced ACL makes SellingAgent text-record ownership meaningful: the SellingAgent's EOA must sign any write to `x402.amount`, `x402.pricing`, `x402.attestation`, or `x402.endpoint`. The platform cannot change these records without the SellingAgent's key.

### KeeperHub — Best Integration + Builder Feedback Bounty

Reckon402 ships:
- **`@reckon402/kh-skill`** (`packages/kh-skill/`, workspace stub at `@0.1.0`, marked private as a post-hackathon stub): a KeeperHub workflow node reference implementation that wraps `@reckon402/buyer-sdk`. Demonstrates Focus Area 2 (Payments) — KeeperHub workflows paying x402-priced APIs autonomously.
- **`recipes/kh-workflow.json`**: A workflow JSON recipe showing three sequential paid calls to `agent.reckon402.com/research`, demonstrating the closed-loop attestation-growth flow that drives the SellingAgent's per-agent Escrow release behavior.

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
- [x] 5 npm packages shipped at `@0.1.0`: `@reckon402/types`, `@reckon402/buyer-sdk`, `@reckon402/middleware-hono`, `@reckon402/facilitator-client`, `@reckon402/erc-8004-client`
- [x] `just test-e2e` (full-flow-l4b) passes green — settlement + ERC-8004 attestation loop confirmed
- [x] `just onboard-l4d` runs end-to-end — 6/6 steps clean (canonical L4d demo flow used to provision seller11)
- [ ] Add team names + contact handles to Section 7
- [x] Add first live attestation tx hash to Section 4
- [x] Add first full-flow settlement tx hash to Section 4
- [ ] Retake all 5 screenshots (landing page changed; screenshot 5 shows bare JSON)
- [ ] Record demo video (2:00–4:00 per ETHGlobal requirements); attach link
- [x] Confirm live `x402.amount` via gateway and update Section 4 numbers if changed
- [ ] Verify all Base Sepolia tx hashes still indexed on Basescan
