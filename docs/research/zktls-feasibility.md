# zkTLS Feasibility for Reckon402 — Research Report

**Date:** 2026-04-30 (≈60h to ETHGlobal OpenAgents submission)
**Author:** research spike
**Scope:** Should we add zkTLS-backed proof of HTTPS response delivery to the ERC-8004 attestation Reckon402 writes on every x402 settlement?

---

## Executive Recommendation

**README-only claim, do NOT ship as a live feature. Confidence: High.**

Ship the *forward-compatible hash format* today (keccak256 over a struct that already has a `responseProof` field, set to `0x00…` for v1). Claim zkTLS as a "v1.5 planned" extension in the pitch. Do not wire live proof generation into the demo flow — the trust-model / latency / topology mismatches are too many to land safely in 60 hours.

---

## Library Survey

Evidence: official docs, npm registry timestamps, GitHub. Anything not verified is flagged `unknown`.

### 1. Reclaim Protocol — **top candidate**
- **Trust model:** Attestor-node network (currently semi-centralised; EigenLayer AVS path "planned but not yet fully deployed" per `reclaimprotocol/attestor-core` README). Client talks to the target site *through* an attestor; attestor signs a commitment over the TLS transcript that the client then turns into a ZK proof redacting secrets.
- **Latency:** ~4 s per proof (Reclaim-published, post-gnark migration). Older Circom path was 10-30 s. zkFetch doc warns the tech is best for "relatively stable data that doesn't change within ~5 s".
- **Where it runs:** `@reclaimprotocol/js-sdk` v5.2.0 (published 2026-04-14) for browser/Node; `@reclaimprotocol/zk-fetch` v0.8.0 (published 2026-02-20) for Node ≥18 server-side; React-Native / iOS / Android / Flutter SDKs for mobile. Cloudflare Workers compatibility is **unverified** — zk-fetch requires a `download-files` post-install step that pulls ZK circuit artifacts, which is incompatible with Workers' bundling model. Open issue #1 requests Bun/macOS support, suggesting non-standard runtimes are not a solved path.
- **Production readiness:** Most mature of the four. "Thousands of proofs daily" per team. Two open issues on zk-fetch as of research date.
- **SDK quality for TS / Workers:** TS types exist; Workers compatibility likely needs a Node sidecar. Integration hours for a working MVP: **8-12 h happy path, 20+ h if Workers-native is required**.

### 2. TLSNotary
- **Trust model:** Single notary + MPC-TLS. Pure cryptography, no TEE.
- **Latency:** `unknown` exact; MPC-TLS is historically multi-second. Only TLS 1.2 (1.3 on roadmap) — most modern merchants negotiate 1.3.
- **Production readiness:** Repo warns "not for production… expect major breaking changes". 56 open issues.
- **SDKs:** Rust + WASM only. **Disqualified for a 60h hack.**

### 3. Pluto
- **Trust model:** hosted stealth-headless-browser attestor signs execution — trust regresses vs. Reclaim's AVS path. JS SDK exists, production status `unknown`.

### 4. Opacity Labs
- **Trust model:** TLSNotary primitives + MPC + EigenLayer AVS. Strongest decentralisation story. **No JS/Node/Workers SDK** — iOS/Android/RN/Flutter only. Disqualified on SDK grounds. Note: `opacity.network` bare domain is a different SEC-listings company; zkTLS project lives at `docs.opacity.network`.

---

## Integration Sketch — if we ignored the "don't ship" recommendation

### Where the proof must be generated
Reclaim zk-fetch runs **server-side**: the calling party initiates an HTTPS request through Reclaim's attestor and gets back a proof. In Reckon402's topology that maps to one of:

| Option | Who calls merchant via Reclaim | Problem |
|---|---|---|
| **A. Buyer-side** | Buyer SDK uses `ReclaimClient.zkFetch(merchant, {X-PAYMENT: ...})` instead of plain `fetch` | Correct topology (proves what buyer actually received). But buyer SDK is Node+viem today — needs ~4 s extra latency and Reclaim app-id/secret distribution to every buyer. Breaks the current buyer UX. |
| **B. Facilitator-side replay** | Facilitator re-fetches merchant post-settle with a recorded request | Does **not** prove the buyer received the response — wrong threat model. |
| **C. Merchant-side self-attestation** | Merchant wraps its own response handler to mint a zk-fetch proof against itself | Nonsense — self-attested. |

**Only Option A is cryptographically meaningful.** That moves zkTLS into the buyer SDK, not the facilitator.

### Binding the proof to the attestation (Option A)
1. Buyer calls `zkFetch(merchantUrl, { headers: { 'X-PAYMENT': eip3009Blob }, body: requestBody })`.
2. Reclaim returns `{ proof, claimData }` where `claimData` commits to request URL + response status + a redacted body digest.
3. Buyer POSTs `{ paymentId, proof, claimData }` to a new facilitator endpoint (e.g. `/feedback/attach-proof`) after settlement.
4. Facilitator verifies the proof (`ReclaimClient.verifyProof`), confirms `paymentId` matches the committed request, computes `responseProof = keccak256(claimData)`, and writes the existing `giveFeedback` with:
   ```ts
   feedbackHash = keccak256(JSON.stringify({
     paymentId, transferTx, distributeTx, authValue, responseProof
   }));
   feedbackURI = "ipfs://…{proof,claimData}";  // optional, off-chain
   ```
5. ERC-8004 attestation is unchanged on-chain; the v1.5 format is a drop-in extension.

### Forward-compatible shim we CAN ship in 60h
Add `responseProof: "0x0000…0000"` to the hashed JSON today. No behaviour change, no new deps, but the v1.5 upgrade becomes a one-liner and the README claim is honest.

---

## 60-Hour Feasibility Verdict

**Verdict: NO for a working feature. YES for a forward-compatible hash format + honest README claim.**

### Why "no" to shipping live zkTLS
1. **Topology flip.** Moving proof-gen to the buyer adds ~4 s/call, needs a new facilitator endpoint, and distributes Reclaim app-id/secret to every buyer. ≥1 full day of plumbing alone.
2. **Cloudflare Workers gap.** `@reclaimprotocol/zk-fetch` needs Node ≥18 + an artifact download step. Workers-native is `unverified`; likely needs a Node sidecar — new infra 60h before demo.
3. **Live-demo hazard.** 4s proof-gen + attestor-availability = exactly the "demo hangs silently" failure mode. No graceful fallback that isn't a lie.
4. **TLS 1.3 matrix.** Reclaim supports 1.3 but coverage is merchant-specific; verification work we don't have time for.

### If we override the recommendation — critical path (estimated 18-26h, tight)
1. **(3h)** Stand up a Node sidecar service (`proof-sidecar`) that wraps `@reclaimprotocol/zk-fetch`. Not in the Worker.
2. **(4h)** Modify buyer SDK so the payment flow is: sign → send via zkFetch → receive 200 + proof.
3. **(3h)** Add `/feedback/attach-proof` endpoint on facilitator; verify proof, check `paymentId` binding, include `responseProof` in `feedbackHash`.
4. **(2h)** Update `feedbackURI` writer to pin `{proof, claimData}` to IPFS (web3.storage free tier).
5. **(4h)** End-to-end demo script + failure-mode handling (fallback to v1 attestation if proof-gen fails > 6 s).
6. **(2-10h)** Debug whatever breaks. It will.

### The dangerous middle ground (do not do this)
- Generating a proof but not verifying it on the facilitator side.
- Shipping a `responseProof` that is filled with a non-zkTLS hash (e.g. hashing the request URL) and calling it "zkTLS-ready" in the README.
- Silent fallback from real proof to placeholder when attestor is down, without surfacing which attestation mode was used.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Proof generation >10 s on demo network | Medium | Demo hang | 6 s timeout → fall back to v1 attestation, log mode |
| Reclaim attestor offline during demo | Low-Med | Demo dead | Pre-generate a recorded proof for demo path |
| Workers runtime cannot load zk-fetch | High | Forces sidecar | Sidecar from day 1, don't try Workers-native |
| Buyer SDK UX regression (4 s added) | High | Loses "instant settle" pitch | Only enable zkTLS in an opt-in flag for demo |
| Merchant TLS 1.3 incompatibility | Unknown | Proof fails | Verify merchant matrix before demo |
| Cost per proof | Unknown | Budget surprise | Free tier on Reclaim dev portal; verify before demo |

---

## Competitive Novelty

**Reckon402-class claim ("x402 payment + ERC-8004 attestation + zkTLS response proof") appears to be first-of-kind as of 2026-04-30, but one related project exists and must be acknowledged:**

- **`github.com/reclaimprotocol/llm-x402`** (Reclaim's own demo). Combines x402 billing on Base with Reclaim zkFetch, but:
  - Proof is generated **server-side** (their hosted LLM router) and attests "we called the upstream model you requested". It does **not** write ERC-8004 attestations.
  - It's a *billing wrapper around an LLM API*, not a generic x402 facilitator.
  - No reputation registry integration, no 8004, no attestor-written feedback.
  - 2 stars, no releases. Hackathon-grade.

- **ERC-8004 + zkTLS combination:** no prior art found via duckduckgo searches and direct GitHub inspection. Tradewise reads 8004 but does not write (per internal memory). Reclaim's project writes no 8004.

**Honest claim Reckon402 can make:** *"First facilitator to write ERC-8004 attestations on x402 settlements, with a forward-compatible hash format designed to carry zkTLS response proofs in v1.5."* — true, verifiable, not overstated.

---

## Recommended Action Items (60h window)

1. **(30 min)** Extend `feedbackHash` pre-image JSON to include `responseProof: "0x00…00"` and bump the format version string. Single line in `facilitator/src/attest.ts` (or wherever the hash is computed). Ship.
2. **(30 min)** README section: "zkTLS Roadmap" — link this doc, cite Reclaim as the intended provider, document Option A topology, reference `llm-x402` as related work.
3. **(skip)** Do not touch buyer SDK, do not add Node sidecar, do not wire Reclaim during the hack.

Total hack-time cost of the honest path: **~1 hour**. Total headline value preserved: "zkTLS-ready reputation oracle" — a slide claim that survives scrutiny.

---

## Evidence Index

- Reclaim: "1-2s" headline on docs; ~4s actual per gnark-migration post-mortem.
- npm: `@reclaimprotocol/zk-fetch@0.8.0` (2026-02-20), `@reclaimprotocol/js-sdk@5.2.0` (2026-04-14).
- GitHub `tlsnotary/tlsn`: explicit "not for production" banner, 56 open issues.
- GitHub `reclaimprotocol/attestor-core`: EigenLayer AVS "planned, not yet deployed".
- GitHub `reclaimprotocol/llm-x402`: only found prior art combining x402 + Reclaim zkFetch; no 8004.
- docs.opacity.network: SDKs iOS/Android/RN/Flutter only, no JS/Node.
