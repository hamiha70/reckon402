# `@reckon402/erc-8004-client`

Canonical ERC-8004 read + write client library for the Reckon402 stack.
Viem-based, multichain, cache-aware. Consumed by the gateway worker
(reads) and the facilitator worker (writes). One library, two consumers.

## ABI pinning

ABIs and canonical addresses are pinned to upstream commit
[`0463311492b3a7fc5fdb6990231cce721ff6cf97`](https://github.com/erc-8004/erc-8004-contracts/tree/0463311492b3a7fc5fdb6990231cce721ff6cf97)
of `erc-8004-contracts`. The constant is exported as `UPSTREAM_ABI_COMMIT`.

## Chains supported

| Chain | chainId | Identity | Reputation | Validation |
|-------|---------|----------|------------|------------|
| Base Sepolia | 84532 | ✅ | ✅ | ❌ (not deployed upstream) |
| Base Mainnet | 8453 | ✅ | ✅ | ❌ (not deployed upstream) |
| Ethereum Sepolia | 11155111 | ✅ | ✅ | ❌ (not deployed upstream) |
| Ethereum Mainnet | 1 | ✅ | ✅ | ❌ (not deployed upstream) |

Validation registry addresses are `null` across all chains at the
pinned commit (upstream: "under active update / TEE community
discussion"). Library methods throw `VALIDATION_NOT_DEPLOYED` when
invoked against those chains.

## Design notes

### `getSummary` requires explicit `clientAddresses`

Upstream ReputationRegistry's `getSummary(agentId, clientAddresses,
tag1, tag2)` reverts with `"clientAddresses required"` when the array
is empty. Use `reputation.getSummaryForAllClients(...)` for the common
aggregate-over-all-clients case — it performs `getClients → getSummary`
as two cached reads.

### Minimal ABI subset

We carry only the function + event entries used by the gateway and
facilitator. Full ABI JSONs from upstream are too large for a CFW
bundle.

### No module-level state

Every public function takes either `(chainId, publicClient)` for reads
or `(chainId, walletClient)` for writes. Cache is an optional
injected dependency. No factories, no classes with internal state.

## Public API

```ts
import {
  identity,
  reputation,
  validation,
  getChainConfig,
  listSupportedChains,
  UPSTREAM_ABI_COMMIT,
  NoopCache,
  LruCache,
} from '@reckon402/erc-8004-client'
import type {
  Agent,
  ReputationSummary,
  FeedbackEntry,
  ValidationStatus,
  ChainConfig,
  KVCache,
} from '@reckon402/erc-8004-client'
```

### Examples

```ts
const pub = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC) })
const cache = new LruCache({ max: 1000 })

// Reputation read (aggregate over all clients; handles the upstream quirk)
const summary = await reputation.getSummaryForAllClients({
  chainId: 84532,
  publicClient: pub,
  cache,
  agentId: 1n,
  tag1: 'payment',
  tag2: 'x402-settlement',
})
// => { count: 0n, summaryValue: 0n, decimals: 0 }
```

## Tests

```bash
pnpm --filter @reckon402/erc-8004-client test
```

Unit tests run against mocked viem clients + a small subset against
real Base Sepolia via the `BASE_SEPOLIA_RPC` env var. Without that var,
live-read tests are skipped with a warning.
