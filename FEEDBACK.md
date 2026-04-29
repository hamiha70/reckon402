# Reckon402 — Builder Feedback for KeeperHub

This file targets the KeeperHub Builder Feedback Bounty ($500).
It captures four concrete gaps in KH's public surface that we hit
while shipping Reckon402's KH workflow + buyer-side x402 integration.

## 1. In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows

KH's documented Turnkey + Direct Execution surface handles on-chain
transactions but not arbitrary EIP-712 typed-data destined for HTTP
bodies. We deployed AWS Lambda + KMS as a workaround
(`lambda/signing/src/handler.ts`, deployed at `signing.reckon402.com/sign`).

A first-party signing helper — e.g., a KH-built Turnkey policy +
workflow primitive that produces signed typed-data without leaving
the sandbox — would turn x402 + KH into a one-line integration
instead of a full infrastructure build.

## 2. ERC-8004 endpoint isn't shipped (per the roadmap)

`app.keeperhub.com/.well-known/erc8004.json`, `/agent.json`, and
`/agent` all returned 404 during the 2026-04-24 verification pass.
We needed merchant reputation data and read it directly from the
canonical ERC-8004 ReputationRegistry on Base Sepolia
(`0x8004B663056A597Dffe9eCcC1965A193B7388713`) — see
`packages/erc-8004-client/`.

A first-party KH wrapper around ERC-8004 reads would let workflows
do reputation-aware execution without external chain reads.

## 3. Payment receipt loop is fire-and-forget today

PR #822 added payer tracking + protocol/chain columns, but a built-in
`wait_for_receipt(paymentId)` step that polls a configured
facilitator's `/receipt` endpoint until a terminal state would close
the loop without requiring custom polling logic.

Reckon402's facilitator exposes such an endpoint
(`GET /x402/receipt/:paymentId`, see `workers/facilitator/`); a
built-in KH primitive that wraps this pattern would generalize to
any x402 facilitator.

## 4. Documentation gap on the buyer side

Existing examples are mostly merchant-side (PRs #818, #821, #822,
#835, #837, #840). An end-to-end "KH workflow as autonomous x402
buyer" worked example would have saved us several hours.

We submit `recipes/kh-workflow.json` + the `@reckon402/kh-skill`
package as a contribution toward this gap.

---

*Reckon402 ships at ETHGlobal OpenAgents 2026 alongside this feedback.
Sponsor track: KeeperHub. Contact: github.com/hamiha70/reckon402.*
