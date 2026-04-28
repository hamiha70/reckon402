# @reckon402/gateway

CCIP-Read Gateway for the Reckon402 ENS identity layer.

Serves `x402.*` text records for merchant names under `reckon402-test.eth`
(Sepolia) via EIP-3668 offchain lookup. Static-dispatch mode (L4a₁).

See `specs/04-l4a-gateway.md` for the full design.

## Quick start (local dev)

```bash
# from repo root
infisical run --env dev -- pnpm --filter @reckon402/gateway dev
```

## Test

```bash
pnpm --filter @reckon402/gateway test
```
