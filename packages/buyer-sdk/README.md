# `@reckon402/buyer-sdk`

Buyer-side helpers for the Reckon402 x402 v2 flow.

## Exports

- `signPayment(input)` — sign an EIP-3009 `TransferWithAuthorization`
  against USDC's EIP-712 domain and build the full `PaymentPayload`.
  Returns `{ payload, paymentId, requirements, authorization }`.
- `encodeXPaymentHeader(payload)` — base64-JSON encode for the
  `PAYMENT-SIGNATURE` header.
- `decodeXPaymentResponse(headerValue)` — parse a `PAYMENT-RESPONSE`
  header back into a `SettlementResponse` (with any Reckon402 X35
  extensions carried through as extra fields).
- `computePaymentId(authorization)` — deterministic
  `keccak256(encodePacked(from, to, value, validAfter, validBefore, nonce))`.
  The facilitator worker imports this same function to guarantee the
  buyer and the facilitator agree on the paymentId byte-for-byte (no
  cross-impl divergence is possible — single source of truth).

## Usage

```ts
import { signPayment, encodeXPaymentHeader, decodeXPaymentResponse }
  from '@reckon402/buyer-sdk'

const { payload, paymentId } = await signPayment({
  privateKey: process.env.BUYER_PK as `0x${string}`,
  recipient: SPLITTER_ADDRESS,
  amount: '10000',                         // 0.01 USDC
  network: 'eip155:84532',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  chainId: 84532,
})

const headerValue = encodeXPaymentHeader(payload)
const res = await fetch('https://agent.reckon402.com/research?q=test', {
  headers: { 'PAYMENT-SIGNATURE': headerValue },
})

const settlement = decodeXPaymentResponse(res.headers.get('PAYMENT-RESPONSE')!)
console.log(settlement.transaction, settlement.paymentId)  // on-chain tx + X35 id
```

No runtime deps beyond `viem` and `@reckon402/types`.
