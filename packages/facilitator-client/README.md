# `@reckon402/facilitator-client`

Two HTTP clients implementing the `Facilitator` interface from
`@reckon402/types`:

- **`CdpFacilitator`** — wraps `https://x402.org/facilitator` (the x402
  Foundation open testnet facilitator). Preserved from L2 for fallback
  and comparison.
- **`Reckon402Facilitator`** — wraps `https://facilitator.reckon402.com/x402`
  (our own facilitator worker, L3+). Canonical x402-v2 fields at the top
  of responses; Reckon402 X35 extensions (`paymentId`, `requestId`,
  `state`, `receipt`) carried through as extra fields.

Both expose the same shape:

```ts
interface Facilitator {
  verify(payload, requirements): Promise<FacilitatorVerifyResponse>
  settle(payload, requirements): Promise<FacilitatorSettleResponse>
}
```

Swapping between them is a one-line constructor change at the middleware
call site.
