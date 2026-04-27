# `@reckon402/facilitator-worker`

Reckon402 x402 v2 facilitator — Hono on Cloudflare Workers with D1 persistence.
Deployed at `facilitator.reckon402.com`.

## Endpoints

- `POST /x402/verify` — validate an EIP-3009 authorization, derive
  `paymentId`, INSERT OR IGNORE a `SUBMITTED` receipt. Idempotent on
  `paymentId`.
- `POST /x402/settle` — two-tx settlement: `USDC.transferWithAuthorization`
  (buyer → Splitter) then `Splitter.distribute(paymentId, amount)` →
  recipients. Inline poll for both receipts; transitions to `CONFIRMED` or
  `FAILED`. Replay-safe: calls on an existing `CONFIRMED` / `RECONCILED`
  row short-circuit from D1 (no new on-chain tx).
- `GET /x402/receipt/:paymentId` — read the Receipt by primary key.
- `GET /x402/receipt/by-tx/:transaction` — read by settlement tx hash.
- `GET /x402/receipt/by-request/:requestId` — read by request UUID.
- `POST /x402/reconcile` — **L3 stub**, returns `{ deferred: true }`. Real
  sweep logic lands at L4.
- `GET /healthz` — dependency probe: d1_read, d1_write, base_rpc_primary,
  base_rpc_fallback, splitter_contract.

Wire format and Facilitator interface: `specs/03-l2-x402-paywall.md`.
D1 schema, state machine, settlement path, reconciler shape:
`specs/04-l3-our-facilitator.md` + design pack `02_facilitator.md`.

## Dev

```bash
pnpm -F @reckon402/facilitator-worker test
pnpm -F @reckon402/facilitator-worker dev
```

## Deploy

```bash
# One-time D1 create:
wrangler d1 create reckon402-d1-facilitator-dev
# copy the database_id into wrangler.toml

# Apply migrations (remote):
wrangler d1 migrations apply reckon402-d1-facilitator-dev --remote

# Put secrets:
wrangler secret put FACILITATOR_PK
wrangler secret put BASE_SEPOLIA_RPC_PRIMARY
wrangler secret put BASE_SEPOLIA_RPC_FALLBACK
wrangler secret put SPLITTER_ADDRESS

# Deploy:
wrangler deploy
```
