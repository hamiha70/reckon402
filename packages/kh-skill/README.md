# `@reckon402/kh-skill`

KeeperHub skill for [Reckon402](https://github.com/hamiha70/reckon402) —
exposes the x402 v2 buyer flow as a `reckon402-buyer` workflow node, backed
by the hosted KMS signing wrapper at `signing.reckon402.com`.

## Current status

**npm-installable; not yet natively executable inside KeeperHub.**

KeeperHub's public custom node SDK is listed as "planned for future release"
in their docs. Today's KH platform runs a fixed set of built-in node types
(`web3`, `discord`, `webhook`, `sendgrid`, etc.); there is no published
extension point for registering a custom `"type": "reckon402-buyer"` node.

What this package provides right now:

- A **stable TypeScript interface** (`Reckon402SkillInput` / `Reckon402SkillOutput`)
  that will map directly to a KH custom node config once KH ships the extension API.
- A **callable `handle()` function** that orchestrates the full x402 buyer flow
  (resolve → sign → pay → wait for settlement). Any Node.js host — a Lambda,
  a Cloudflare Worker, or a future KH custom node runtime — can import and call it.
- A **reference workflow definition** (`recipes/kh-workflow.json`) that can be
  imported into KH today via the `POST /api/workflows/create` → `PATCH` flow and
  published publicly via `PUT /api/workflows/{id}/go-live`. KH users can
  discover and clone the workflow; the node config documents exactly what
  parameters the `reckon402-buyer` type expects.

What it does **not** provide yet:

- A manifest file that registers `"reckon402-buyer"` as an executable node type
  inside KH (no such schema is published).
- Native in-KH execution of `"type": "reckon402-buyer"` nodes — those nodes
  would be treated as unknown and skipped/errored by the current KH runtime.

For live x402 execution inside a KH workflow today, wire the built-in KH
`webhook` node to call `https://signing.reckon402.com/sign` directly, then
POST to the merchant endpoint with the returned signature header. The full
`recipes/kh-workflow.json` documents the intended node structure for when the
extension API ships.

## Install

```bash
npm install @reckon402/kh-skill @reckon402/buyer-sdk @reckon402/types
```

## Usage (5 lines)

```ts
import { handle } from '@reckon402/kh-skill'

// SIGNING_WRAPPER_API_KEY must be in env
const result = await handle({
  merchantUrl: 'https://agent.reckon402.com',
  path: '/research?q=hello',
  amountUsdc: 0.01,
  network: 'base-sepolia',      // or 'base' for mainnet
})

console.log(result.receiptId, result.tx)
// 0x9735e05e...  0xce89c9c6...
```

## Exports

- `handle(input)` — skill entry point; maps KH node config → buyer-sdk payment
  flow → `{ receiptId, tx, reputation }`.
- `getSigningWrapperUrl()` — resolves the signing wrapper URL from env or falls
  back to the hosted default.
- `Reckon402SkillInput` / `Reckon402SkillOutput` — TypeScript interfaces for
  the node's input/output contract (stable across buyer-sdk reworks).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SIGNING_WRAPPER_API_KEY` | Yes | API key for `signing.reckon402.com/sign` |
| `SIGNING_WRAPPER_URL` | No | Override signing endpoint (default: hosted) |

## Role of the signing wrapper

KeeperHub's in-sandbox Turnkey wallet cannot sign EIP-712 typed-data payloads
for x402 HTTP headers directly. This skill routes all signing through the
[Reckon402 signing wrapper](https://signing.reckon402.com) — a Lambda-backed
HTTPS endpoint that holds the buyer EVM private key in AWS KMS (`eu-central-1`).
The wrapper accepts an EIP-712 `TransferWithAuthorization` typed-data payload
and returns the signature; zero key material leaves the KMS boundary.

```
POST https://signing.reckon402.com/sign
X-Api-Key: <SIGNING_WRAPPER_API_KEY>
{ "typedData": { ...EIP-712 TransferWithAuthorization... } }

→ { "signature": "0x...", "signerAddress": "0x46bb..." }
```

## How to use in KeeperHub

Import [`recipes/kh-workflow.json`](https://github.com/hamiha70/reckon402/blob/main/recipes/kh-workflow.json)
into [app.keeperhub.com](https://app.keeperhub.com) as a new workflow.
The workflow defines three sequential `reckon402-buyer` nodes demonstrating
ERC-8004 reputation growth and tier-based discount pricing: base price →
5% discount → 10% discount as on-chain attestations accumulate from real
USDC settlements on Base.

### KeeperHub workflow node shape

```json
{
  "id": "call_1",
  "type": "reckon402-buyer",
  "description": "First research call — base price (0.01 USDC)",
  "config": {
    "merchant_url": "https://agent.reckon402.com",
    "path": "/research?q=alpha+agent+commerce",
    "amount_usdc": 0.01,
    "network": "base-sepolia",
    "signing_wrapper_url": "https://signing.reckon402.com/sign",
    "auth_secret": "${SIGNING_WRAPPER_API_KEY}",
    "wait_for_state": "RECONCILED"
  }
}
```

Set `SIGNING_WRAPPER_API_KEY` in the workflow's secret store — do not paste
the plaintext value into the config. Subsequent nodes can set
`"amount_usdc": null` to let the gateway return the tier-discounted price
that reflects the previous settlement's ERC-8004 attestation.

## End-to-end flow

```
KH workflow node ("reckon402-buyer")
  → handle()                          [this package]
    → @reckon402/buyer-sdk             construct EIP-3009 typed data
    → signing.reckon402.com/sign       KMS signs, returns signature
    → agent.reckon402.com/research     x402 paywall — 402 → pay → 200
    → facilitator.reckon402.com/settle on-chain USDC + ERC-8004 attestation
  ← { receiptId, tx, reputation }
```

Each settled call writes an ERC-8004 `NewFeedback` event to the Base
`ReputationRegistry`. The gateway reads the updated reputation on the
next call and returns the discounted price automatically.

## Links

- **Monorepo:** [github.com/hamiha70/reckon402](https://github.com/hamiha70/reckon402)
- **Facilitator:** [https://facilitator.reckon402.com](https://facilitator.reckon402.com)
- **Signing wrapper:** [https://signing.reckon402.com](https://signing.reckon402.com)
- **Buyer SDK:** [`@reckon402/buyer-sdk`](https://www.npmjs.com/package/@reckon402/buyer-sdk)
- **Types:** [`@reckon402/types`](https://www.npmjs.com/package/@reckon402/types)

## License

MIT
