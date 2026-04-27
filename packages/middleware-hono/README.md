# `@reckon402/middleware-hono`

Hono middleware factory that gates a route behind an x402 v2 paywall.

## Usage

```ts
import { Hono } from 'hono'
import { withX402 } from '@reckon402/middleware-hono'
import { Reckon402Facilitator } from '@reckon402/facilitator-client'

const app = new Hono()

app.use(
  '/research',
  withX402({
    amount: '10000',                            // 0.01 USDC
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    recipient: SPLITTER_ADDRESS,                // L3: Splitter, not seller
    facilitator: new Reckon402Facilitator(),
  }),
)

app.get('/research', (c) => c.json({ answer: '...' }))
```

The middleware is Facilitator-agnostic: swap `Reckon402Facilitator` for
`CdpFacilitator` without touching the middleware itself.

## Tests

The package's vitest suite locks in the exact `PaymentRequirements` the
middleware passes to `Facilitator.verify()` / `.settle()` — the load-bearing
invariant that protects merchant payment terms across every facilitator
swap.
