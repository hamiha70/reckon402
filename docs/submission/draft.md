# Reckon402 — ETHGlobal OpenAgents 2026 Submission Draft

> **Status:** DRAFT — for human review before submission.
> Do not paste into ETHGlobal form until all `[TODO]` markers are resolved.
> Canonical source for names/taglines: `x402_BusModels/history/ETHGLobal_OpenAgents_2026/research/project_branding.md`.

---

## 1. One-Paragraph Pitch

Reckon402 is a closed-loop settlement-attestation primitive for agent commerce. Every confirmed x402 payment triggers an ERC-8004 reputation write to the canonical Base registry; every subsequent ENS resolution reads that reputation back to compute a per-caller price tier. The result is a trust loop that closes inside a single demo: a SellingAgent that has never been paid before gets a lower price the moment it has accumulated real, on-chain settlement history. No competitor closes this loop in production — Tradewise Agentlab and `@agentscore-xyz/x402-gate` read ERC-8004 but do not write post-settlement. The write side, wired into ENS-resolved x402 routing with SellingAgent-sovereign text records, is what Reckon402 owns.

---

## 2. What It Does

### x402 Facilitator — Real USDC on Base Sepolia

Reckon402 runs a stateful x402 v2 facilitator at `https://facilitator.reckon402.com`. Every payment follows an explicit state machine: `SUBMITTED → PENDING_CONFIRMATION → CONFIRMED → RECONCILED`, with `FAILED` as a sibling terminal. Idempotent retry keys off a deterministic `paymentId = keccak256(eip3009TypedData ‖ nonce)` — replaying the same EIP-3009 authorization twice returns the same `paymentId` and causes no double-spend. Receipts are wire-compatible with the x402 v2 `SettlementResponse` shape and extend it with `paymentId`, `state`, `retryCount`, and lineage fields that Reckon402-aware callers can inspect. Real USDC settles on Base Sepolia; the seller has accumulated **20.22 USDC** across live settlements as of submission.

### ERC-8004 Attestation WRITE After Every Settlement

After every `CONFIRMED` payment the Treasury-Deposit worker writes a `ReputationRegistry` feedback entry tagged `("payment", "x402-settlement")`, linked to the receipt URI and content hash. The first live attestation landed at tx `0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2` on Base Sepolia. Writes are idempotent on `(paymentId, agentId)`. The SellingAgent's `x402.attestation` ENS text record controls opt-in; the SellingAgent owns that record under the gateway-enforced ACL — Reckon402 cannot silently disable attestation for a SellingAgent it wants to disadvantage.

### ENS-Resolved Pricing That Reads Reputation Back

The gateway at `https://gateway.reckon402.com` implements EIP-3668 + ENSIP-10 wildcard resolution via `ezccip.js`. The on-chain resolver (`Reckon402Resolver` at `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a` on Ethereum Sepolia) encodes `msg.sender` into `callData` (CCIP-Read Pattern A), so vanilla `viem` and `wagmi` clients work without custom code. The gateway decodes the caller, reads the ERC-8004 `ReputationRegistry` on Base Sepolia to find the caller's feedback count, maps that count to a pricing tier, and returns a signed `x402.amount` record. The current live SellingAgent (`reckon402-test.eth`) has accumulated enough settlements to reach the 10% discount tier: base amount `100000` base units, current live amount `90000` base units.

### SellingAgent Onboarding in ~60 Seconds

The onboarding CLI (`tools/onboard-seller`) provisions a new SellingAgent end-to-end: it mints an ENS subname (`seller{N}.reckon402-test.eth`), deploys a Splitter lockbox via `SplitterFactory` (`0x0ad507c6973eba86313794329ad9b12fbf24acd0` on Base Sepolia), registers an ERC-8004 `agentId` in the `IdentityRegistry`, and sets ENSIP-25 text records linking the ENS name to the agentId. The onboarding dashboard shows five sequential steps with green checks and Basescan/Etherscan links as each completes.

### Gateway-Enforced ACL: "The Platform Cannot Turn On You"

ENS text records are split by ownership. **SellingAgent-owned** records — `x402.amount`, `x402.pricing`, `x402.endpoint`, `x402.attestation`, `x402.yield` — require a signature from the subname owner's EOA. **Reckon402-owned** records — `x402.splitter`, `x402.facilitator`, `x402.erc8004.registry`, `x402.erc8004.agent_id` — require a signature from the Reckon402 onboarding EOA. The gateway verifies each write against `registry.owner(namehash)` and per-key ACL. A SellingAgent's pricing and attestation opt-in are cryptographically theirs; Reckon402 cannot front-run pricing or silently reroute payments.

---

## 3. How It's Built

**Smart contracts (Foundry + Solidity 0.8.24):** The `Splitter` contract is a deliberately-minimal immutable BPS-based router — no admin, no upgrade path, no transferable rights. A `getRecipient(slot)` view function leaves a forward-compatibility hook for v2 ERC-1155 revenue-stream tokenization without modifying the audited v1 surface. `SplitterFactory` deploys deterministic instances per SellingAgent via CREATE2. `Reckon402Resolver` is a thin CCIP-Read wrapper that issues `OffchainLookup` with `msg.sender` encoded in `callData`.

**Workers (Cloudflare Workers + D1):** The facilitator, gateway, and orchestrator each run as Cloudflare Workers. D1 stores payment state, ENS text records (the off-chain record store backing the CCIP-Read resolver), and SellingAgent registration. The gateway's signed-write endpoint verifies EOA signatures and enforces the per-key ACL before writing to D1.

**Signing (AWS KMS + Lambda):** A hosted EIP-3009 signing wrapper at `signing.reckon402.com` lets BuyingAgent runtimes that cannot sign EIP-712 typed-data inline (e.g., sandbox-constrained agent platforms) participate as x402 buyers. The wrapper holds an isolated signing key in KMS, exposes `POST /sign`, and logs every request.

**ENS + CCIP-Read:** `reckon402-test.eth` resolves via `Reckon402Resolver` on Ethereum Sepolia using ENSIP-10 wildcard. The gateway implements EIP-3668 via `ezccip.js` (resolverworks/ezccip.js, Cloudflare Workers native). ENSIP-25 text records (`erc8004.registry`, `erc8004.agent_id`) are set at SellingAgent onboarding, creating the canonical ENS↔ERC-8004 binding.

**ERC-8004 integration:** The `@reckon402/erc-8004-client` package reads and writes the canonical `ReputationRegistry` and `IdentityRegistry` on Base Sepolia. The client is UPSTREAM_ABI_COMMIT-pinned to `0463311492b3a7fc5fdb6990231cce721ff6cf97`.

**Frontend:** Next.js dashboard at `https://app.reckon402.com` shows the SellingAgent's ENS name, agentId, Splitter address, static tier config table, live feedback count, trust badge, and a per-payment call log with settlement tx and attestation tx links.

---

## 4. Live Deployments & On-Chain Evidence

- **Facilitator:** https://facilitator.reckon402.com
- **SellingAgent endpoint:** https://agent.reckon402.com
- **Gateway:** https://gateway.reckon402.com
- **Frontend:** https://app.reckon402.com `[TODO: confirm 08B deploy is live before submission]`
- **ENS name:** `reckon402-test.eth` on Ethereum Sepolia, resolving via CCIP-Read
- **Reckon402Resolver (Ethereum Sepolia):** `0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a`
- **SplitterFactory (Base Sepolia):** `0x0ad507c6973eba86313794329ad9b12fbf24acd0`
- **Splitter deploy tx (Base Sepolia):** `0xaa3cb87703c8320a7ece5b2d267d9101fd89199cf9c066fec9fde765b77af443`
- **First live ERC-8004 attestation tx (Base Sepolia):** `0xf3fd14044152cb9a15912b030c9209a69ce7aa5687c32937f4c07ce142ab61e2`
- **First full-flow settlement tx (Base Sepolia):** `0x5efd44aa122f807113ad036328c74589dd65c803ea30bed281acb32f852ea6e5`
- **Real production impact:** seller has accumulated **20.22 USDC** across real settlements; current live pricing `90000` base units (10% tier-2 discount from base `100000`)
- **Facilitator EOA (Base Sepolia):** `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`
- **D1 (facilitator):** `reckon402-d1-facilitator-dev` (ID `ad5bd36d-1903-4340-bc27-1f46b878b2c0`)
- **D1 (gateway):** `reckon402-d1-gateway-dev` (ID `926ca731-4952-438e-a70c-f19722dc25b0`)
- **agentId 1 stats (Base Sepolia):** 9 BuyingAgent clients, 56 untagged feedback entries

`[TODO: add mainnet ENS reckon402.eth + Reckon402Resolver mainnet address once registered]`

---

## 5. What's Next

### Delivery-Proof: Volume Cap vs Per-Transaction Truth

Today's settlement attestation caps fraud volume. A SellingAgent with a strong on-chain reputation cannot commit unlimited fraud without eventually losing tier status — the attestation count is bounded by paid settlements, and a SellingAgent that delivers nothing eventually stops receiving discounted prices. But attestations do not prove that a specific paid request was correctly delivered; fraud is possible inside the paid set.

Post-hackathon, Reckon402 will close this per-transaction gap via a **BuyingAgent-side delivery-proof SDK** using Reclaim Protocol (`@reclaimprotocol/zk-fetch`) zkTLS. A BuyingAgent that receives a failed or incorrect paid response generates a zkTLS proof of the failure (proof generation runs off the critical settlement path, ~4s, Node ≥18) and submits it post-facto to the facilitator for a negative ERC-8004 attestation against the SellingAgent's `agentId`, or a refund path. This closes the exact gap that settlement-caps leave open: settlement caps fraud *volume*; delivery-proof catches fraud *inside the paid set*.

Note: live zkTLS is not shipping for this hackathon. A feasibility spike (`docs/research/zktls-feasibility.md`) confirmed that proof generation requires a witness to be in the TLS session path — post-facto transcript proofs are claims, not proofs — and the tooling is incompatible with Cloudflare Workers. The post-hackathon path routes proof generation through the BuyingAgent SDK (Node.js), where the constraint does not apply.

### Other Roadmap Items

- **Mainnet deployment:** `reckon402.eth` ENS name and `Reckon402Resolver` are registered/deployed on Ethereum mainnet for credibility and ENSIP-25 prize signal. The full settlement stack (SplitterFactory, ERC-8004 agentId registration, facilitator) remains on Base Sepolia for this demo. Flipping to Base Mainnet requires changing one env var (`ERC8004_CHAIN_ID`) — no code change.
- **Nanopayment batching:** At `$0.10` unit pricing, per-payment gas is acceptable. At sub-cent unit prices (the natural endpoint of agent microservices), batching N EIP-3009 authorizations into one settlement transaction becomes necessary. Designed as a v1.5 path; scaffolded but not shipped.
- **Multi-runtime BuyingAgent SDK:** The same `reckon402.pay()` shape ships as `@reckon402/buyer-sdk` (npm/TypeScript), a LangChain toolkit (`langchain-reckon402`, PyPI), and an MCP server (`@reckon402/mcp-server`) so any AI-agent runtime can become an x402 buyer.

---

## 6. Tracks & Prizes

### Primary: ETHGlobal OpenAgents

The core submission. Reckon402 is a settlement-attestation primitive for agent commerce. The demo shows a SellingAgent onboarded in ~60 seconds and a BuyingAgent accumulating reputation across three sequential paid calls — on-chain, verifiable, no mocks.

### ENS — Best ENS Integration for AI Agents + Most Creative Use

ENS is not cosmetic here. `reckon402-test.eth` is the SellingAgent's identity and pricing oracle simultaneously. The CCIP-Read resolver returns different `x402.amount` values to different BuyingAgents based on their on-chain ERC-8004 reputation — the same ENS name, different price, depending on who asks. ENSIP-25 text records (`erc8004.registry`, `erc8004.agent_id`) are written at onboarding, creating the ENS↔ERC-8004 canonical binding. The gateway-enforced ACL makes SellingAgent text-record ownership meaningful, not cosmetic: the SellingAgent's EOA must sign any write to `x402.amount`, `x402.pricing`, `x402.attestation`, or `x402.endpoint`. The platform cannot change these records without the SellingAgent's key.

### KeeperHub — Best Integration + Builder Feedback Bounty

Reckon402 ships three parallel adoption surfaces:
- **`@reckon402/kh-skill`** (npm): a KeeperHub workflow node that wraps `@reckon402/buyer-sdk`. Demonstrates Focus Area 2 (Payments) — KeeperHub workflows paying x402-priced APIs autonomously.
- **`langchain-reckon402`** (PyPI): a LangChain toolkit wrapping the live facilitator. This is the KeeperHub prize qualifying artifact (KH prize criteria accept PyPI packages as submission artifacts).
- **`@reckon402/mcp-server`** (npm): stdio MCP server so any MCP-compatible AI runtime (Claude Code, Codex, KH workflow builder) can make x402 payments as tool calls.

**Builder Feedback Bounty (`FEEDBACK.md`):** Four concrete gaps found while integrating KeeperHub:
1. In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows. We built around it with an AWS Lambda + KMS signing wrapper (`signing.reckon402.com`); a first-party KH signing primitive would make this a one-line integration.
2. ERC-8004 endpoint not yet live (404 at `app.keeperhub.com/.well-known/erc8004.json`); we read the canonical Base registry directly.
3. Payment receipt loop is fire-and-forget today; a built-in `wait_for_receipt(paymentId)` step would close the loop without custom polling logic.
4. Documentation gap on the buyer side; existing examples are merchant-side. We submit `recipes/keeperhub.json` + `recipes/keeperhub.md` as a contribution.

---

## 7. Team & Contact

`[TODO: fill in team member names, Telegram handles, X/Twitter handles]`

- **GitHub:** https://github.com/hamiha70/reckon402
- **Live Demo:** https://app.reckon402.com
- **Facilitator:** https://facilitator.reckon402.com
- **Gateway:** https://gateway.reckon402.com

---

## Review Checklist Before Submitting

- [ ] Confirm `app.reckon402.com` (frontend 08B deploy) is live
- [ ] Confirm `reckon402.eth` mainnet ENS registered + Reckon402Resolver mainnet address; add to Section 4
- [ ] Confirm `langchain-reckon402` PyPI package published (KeeperHub prize path)
- [ ] Confirm `@reckon402/mcp-server` published to npm
- [ ] Add team names + contact handles to Section 7
- [ ] Verify all Base Sepolia tx hashes are still indexed on Basescan
- [ ] Confirm live `x402.amount` record via `curl gateway.reckon402.com/lookup/seller1.reckon402-test.eth/x402.amount` and update Section 4 numbers if changed
- [ ] Record demo video (2:00–4:00 per ETHGlobal requirements); attach link
- [ ] Add GitHub repo link to Section 7 once repo is public
