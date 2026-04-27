# Spec 03 — L2: canonical x402 v2 paywall + shared types package

Status: implementation contract.
Sources: x402 Foundation spec (github.com/x402-foundation/x402), design pack
`02_facilitator.md` §4.1/§4.2/§5, `alignment_decisions.md`, live AGENTS.md.

---

## 1. Purpose and scope

Extend `workers/agent` with a canonical x402 v2 paywall on `/research` via
the public x402.org facilitator (development/testnet endpoint, no auth).
Extract canonical wire-format types into a new workspace package
`@reckon402/types`. End state: `agent.reckon402.com/research` returns 402
on missing payment and 200 + on-chain USDC transfer on valid payment.

Two surfaces ship at L2:
- **`packages/types`** — pure TypeScript types, zero runtime deps.
- **`workers/agent` extension** — Hono middleware + CDP-concrete facilitator
  impl + paymentId computation.

---

## 2. Facilitator endpoint choice (L2 vs. L3)

| Layer | Facilitator | Auth | URL |
|-------|-------------|------|-----|
| L2 | x402.org public endpoint | none | `https://x402.org/facilitator` |
| L3 | reckon402 own (CFW + D1) | none (internal) | `https://facilitator.reckon402.com` |

L2 uses `https://x402.org/facilitator` — the canonical open testnet facilitator
from the x402 Foundation repo. CDP authenticated endpoint
(`https://api.cdp.coinbase.com/platform/v2/x402`) requires JWT provisioning;
deferred to L3 if needed. The `Facilitator` interface is agnostic to both.

---

## 3. Wire format (canonical x402 Foundation v2)

Source: `github.com/x402-foundation/x402` (spec dated 2025-12-09, `x402Version: 2`).
Cross-checked against design pack `02_facilitator.md` §5 wire-compat invariants.

### 3.1 402 response

```
HTTP 402 Payment Required
PAYMENT-REQUIRED: base64(JSON)
```

`PAYMENT-REQUIRED` header decodes to `XPaymentRequired`:

```ts
{
  x402Version: 2,                        // integer, NOT "version"
  error?: string,
  resource: { url: string, description?: string, mimeType?: string },
  accepts: PaymentRequirements[],
  extensions?: Record<string, unknown>
}
```

Each `PaymentRequirements` item:

```ts
{
  scheme: "exact",
  network: "eip155:84532",               // CAIP-2 string — NOT integer
  amount: "10000",                        // atomic units; 0.01 USDC = 10000 (6 decimals)
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // USDC on Base Sepolia
  payTo: "0xD53ffac42496d73B3Faf946786688a8454F57b1f",  // seller EOA; field is payTo, NOT recipient
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" }  // EIP-712 domain info for signing
}
```

### 3.2 Client payment header

```
PAYMENT-SIGNATURE: base64(JSON)
```
(canonical v2 header name; `x-payment` is accepted as fallback alias per SDK source)

Decodes to `PaymentPayload`:

```ts
{
  x402Version: 2,
  resource?: { url: string },
  accepted: PaymentRequirements,          // chosen requirements item
  payload: {
    signature: "0x...",                   // flat 65-byte hex (viem signTypedData output)
    authorization: {
      from: "0x...",                      // payer address (field: from)
      to:   "0x...",                      // recipient address
      value: "10000",                     // atomic units as string
      validAfter:  "1735000000",          // unix timestamp string
      validBefore: "1735000300",          // unix timestamp string; must be > now + 30s
      nonce: "0xabc..."                   // 0x-prefixed bytes32 random
    }
  },
  extensions?: Record<string, unknown>
}
```

### 3.3 Settlement response header

```
PAYMENT-RESPONSE: base64(JSON)
```

Decodes to `SettlementResponse`:

```ts
{
  success: boolean,
  transaction: "0x...",                   // tx hash; field is transaction, NOT txHash
  network: "eip155:84532",               // CAIP-2
  payer?: "0x...",                        // field is payer, NOT from at top level
  errorReason?: string,
  amount?: string
}
```

### 3.4 Wire-compat invariants (from design pack §5)

1. `network` is CAIP-2 string (`eip155:8453`, `eip155:84532`), NOT integer.
2. `x402Version: 2` only. Reject anything else with HTTP 400.
3. `validBefore - now() ≥ 30s` deadline enforced by worker pre-check.
4. Receipt top-level uses `transaction` (NOT `txHash`), `payer` (NOT `from`).
5. URL paths unversioned: `/x402/verify`, `/x402/settle`.
6. Reckon402 X35 extensions (`paymentId`, `state`, `receipt`) sit at the
   bottom of `FacilitatorSettleResponse`; canonical callers can ignore them.

### 3.5 x402.org facilitator API

- `POST https://x402.org/facilitator/verify`
  - Request: `{ x402Version: 2, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements }`
  - Response: `{ isValid: boolean, payer?: string, invalidReason?: string }`
- `POST https://x402.org/facilitator/settle`
  - Request: same
  - Response: `{ success: boolean, transaction: string, network: string, payer?: string, errorReason?: string }`

---

## 4. `@reckon402/types` package

Location: `packages/types/`. Version `0.1.0`. No npm publish during L2.

### 4.1 File tree

```
packages/types/
├── package.json         name @reckon402/types, version 0.1.0, private: false
├── tsconfig.json        extends ../../tsconfig.base.json
├── README.md            ~30 lines
└── src/
    ├── index.ts         barrel: re-exports x402.ts + facilitator.ts
    ├── x402.ts          PaymentRequirements, XPaymentRequired, PaymentPayload,
    │                    EIP3009Authorization, SettlementResponse
    └── facilitator.ts   FacilitatorVerifyResponse, FacilitatorSettleResponse,
                         Facilitator interface
```

### 4.2 `Facilitator` interface (superset design)

The `Facilitator` interface is the L2↔L3 swap point. CDP and Reckon402 both
implement it. L2's `CdpFacilitator` translates Foundation wire → x402.org API.
L3's `Reckon402Facilitator` will translate Foundation wire → design pack §4.1
format (`{ version, network, authorization, signature }`).

```ts
export interface Facilitator {
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<FacilitatorVerifyResponse>

  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<FacilitatorSettleResponse>
}

export interface FacilitatorVerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  // Reckon402 X35 extensions (CDP omits these; Reckon402 L3 populates them)
  paymentId?: string
  requestId?: string
  state?: string
}

export interface FacilitatorSettleResponse {
  success: boolean
  transaction: string         // tx hash; field name: transaction
  network: string             // CAIP-2
  payer?: string
  errorReason?: string
  amount?: string
  // Reckon402 X35 extensions
  paymentId?: string
  requestId?: string
  state?: string
  receipt?: Record<string, unknown>
}
```

ZERO runtime deps. ZERO `console.log`. Pure type defs only.

---

## 5. Worker design

### 5.1 New files under `workers/agent/src/`

| File | Purpose |
|------|---------|
| `x402-middleware.ts` | Hono `withX402` factory (~80-120 lines) |
| `cdp-facilitator.ts` | `CdpFacilitator` implements `Facilitator` (~60-100 lines) |
| `payment-id.ts` | deterministic paymentId computation (~30 lines) |

`index.ts` updated: gates `/research` via `withX402`; `/` and `/health` stay free.

### 5.2 `withX402` middleware shape

```ts
export function withX402(opts: {
  amount: string
  network: string              // CAIP-2
  asset: string                // USDC address
  recipient: string            // payTo address
  facilitator: Facilitator
}): MiddlewareHandler
```

Mounted per-route: `app.use('/research', withX402({ ..., facilitator: new CdpFacilitator() }))`

### 5.3 Middleware flow

1. Read `PAYMENT-SIGNATURE` header (fallback: `x-payment`).
2. If absent: set `PAYMENT-REQUIRED` header, return `c.json({}, 402)`.
3. Decode + validate header:
   - base64-decode → JSON-parse; on failure → 400.
   - `x402Version !== 2` → 400 `{ error: "UNSUPPORTED_VERSION" }`.
   - `validBefore - now() < 30s` → 402 `{ error: "DEADLINE_TOO_TIGHT" }`.
   - `network` mismatch → 402 `{ error: "WRONG_NETWORK" }`.
4. Call `facilitator.verify(payload, requirements)`.
   - `!isValid` → 402 with `{ error: result.invalidReason }`.
5. Compute paymentId (via `payment-id.ts`), log to worker console.
6. Call `facilitator.settle(payload, requirements)`.
   - `!success` → 502 with `{ error: result.errorReason }`.
7. Set `PAYMENT-RESPONSE` header with base64(settlementResult).
8. `await next()`.

### 5.4 `paymentId` computation

```ts
// keccak256(abiEncode(eip712TypedData) || nonce)
// per design pack 02_facilitator.md §4.1 step 6
// Uses viem's keccak256 + encodePacked helpers.
```

Worker logs paymentId on every payment attempt from L2 onward.
CDP won't echo it back (it's a Reckon402 X35 extension); the log provides
forward-compat tracing for L3 facilitator swap.

### 5.5 Wrangler env bindings added

No new secrets required for L2 (x402.org facilitator is public, no auth).
Seller address and amounts are constants in the worker code at L2 (hardcoded
to AGENTS.md values). L3 will move these to wrangler env vars.

---

## 6. EIP-712 signing (buyer side — integration test only)

USDC on Base Sepolia:
- Address: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- EIP-712 domain: `{ name: "USDC", version: "2", chainId: 84532, verifyingContract: <above> }`

viem `signTypedData` returns flat 65-byte hex `0x{r}{s}{v}` — used directly as
`PaymentPayload.payload.signature`. No v/r/s split needed.

Integration test buyer:
- Address: `0x837e30740a4A5bAC5480b4f707924469d42b43De` (Buyer-demo-1)
- PK from Infisical: `BUYER_DEMO_1_PK`
- Amount: 10000 USDC base units (0.01 USDC)
- `validBefore`: `now + 600s` (10 min, well above 30s floor)

---

## 7. Test plan

### 7.1 Unit tests (vitest)

`workers/agent/test/x402-middleware.test.ts` — 6 cases via mocked `Facilitator`:

1. Missing `PAYMENT-SIGNATURE` → 402 + `PAYMENT-REQUIRED` header set
2. Malformed header (not valid base64-JSON) → 400
3. `x402Version !== 2` → 400 with `UNSUPPORTED_VERSION`
4. Expired authorization (`validBefore < now + 30s`) → 402 `DEADLINE_TOO_TIGHT`
5. `facilitator.verify` returns `isValid: false` → 402 with `invalidReason`
6. Verify succeeds → settle succeeds → 200 + `PAYMENT-RESPONSE` header + body passthrough

`workers/agent/test/cdp-facilitator.test.ts` — 3 cases via `fetch` mock:

1. `verify` success → maps CDP response to `FacilitatorVerifyResponse`
2. `verify` failure (`isValid: false`) → correct `invalidReason` propagated
3. `settle` success → maps to `FacilitatorSettleResponse` with `transaction` field

### 7.2 Integration test (bash + viem)

`tools/integration-tests/buyer-sign.mjs` — Node ESM, one-shot:
- Reads `BUYER_DEMO_1_PK`, `BASE_SEPOLIA_RPC_PRIMARY` from env (Infisical-hydrated)
- Signs EIP-3009 authorization via viem
- Emits base64-encoded `PAYMENT-SIGNATURE` value to stdout

`tools/integration-tests/agent-paywall.sh` — asserts:
1. `curl /research` without payment header → HTTP 402 + `PAYMENT-REQUIRED` header
2. With valid `PAYMENT-SIGNATURE` → HTTP 200 + JSON body + `PAYMENT-RESPONSE` header
3. Extract tx hash from `PAYMENT-RESPONSE`, print Basescan link
4. Verify tx via `cast` against Base Sepolia RPC

---

## 8. Definition of done

- [ ] `specs/03-l2-x402-paywall.md` committed.
- [ ] `packages/types/` committed; `pnpm install -r` resolves cleanly.
- [ ] `workers/agent/` extension committed; all vitest unit tests pass.
- [ ] `tools/integration-tests/{buyer-sign.mjs, agent-paywall.sh}` + run log committed.
- [ ] `agent-paywall.sh` exits 0 against live `agent.reckon402.com`.
- [ ] Real on-chain tx visible on Basescan: 10000 base-unit USDC from
  `0x837e...43De` to `0xD53f...7b1f` on Base Sepolia.
- [ ] `wrangler tail` captured at least one verify+settle round-trip.
- [ ] `L2-paywall-via-cdp` annotated tag created and pushed.

---

## 9. Open questions

**Q-03-α** — RESOLVED: `02_facilitator.md` §4.1 example shows `requestId: "01J..."`
(ULID-shaped) but §3.1 and §5 both say UUID v4. Resolution: §4.1 example is a typo;
UUID v4 is canonical. Flag to research-repo maintainer for correction before L3 spec
authors read that section.

**Q-03-β** — RESOLVED: Design pack §4.1 verify request uses `version: 2`; x402
Foundation canonical spec uses `x402Version: 2`. These are different API layers —
no conflict. L3 Reckon402Facilitator HTTP API will use `version: 2` internally;
`@reckon402/types` `PaymentPayload` uses `x402Version: 2` (Foundation wire). The
`CdpFacilitator` and future `Reckon402Facilitator` both translate at their boundary.

**Q-03-γ** — RESOLVED: x402.org/facilitator POST /verify and /settle respond
correctly to API calls (HTML GET returns 404, API endpoints work). Two on-chain
settlements confirmed against this endpoint in the L2 integration run. No fallback
to CDP authenticated endpoint needed at L2.
