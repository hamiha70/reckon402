# @reckon402/types

Canonical x402 Foundation v2 wire-format TypeScript types for Reckon402.

Zero runtime dependencies. Pure type definitions.

## Install

```bash
npm install @reckon402/types
```

In the monorepo (workspace consumption):

```jsonc
// in any packages/* or workers/* package.json:
{ "@reckon402/types": "workspace:*" }
```

## Usage

```ts
import type {
  PaymentRequirements,
  PaymentPayload,
  XPaymentRequired,
  SettlementResponse,
  Facilitator,
  FacilitatorVerifyResponse,
  FacilitatorSettleResponse,
} from '@reckon402/types'
```

## Wire-compat notes

- `network` field: CAIP-2 string (`eip155:8453`, `eip155:84532`), never integer.
- `x402Version: 2` only — workers reject any other value.
- `transaction` (not `txHash`), `payer` at top level (not `from`).
- `payTo` in `PaymentRequirements` (not `recipient`).
- `Facilitator` interface is the L2↔L3 swap point: `CdpFacilitator` (L2)
  and `Reckon402Facilitator` (L3) both implement it.
