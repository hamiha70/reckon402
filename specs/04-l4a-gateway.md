# 04 — L4a Gateway (CCIP-Read worker + wildcard resolver + ERC-8004 reads)

**Status:** v2, locked. L4a₁ static-dispatch green 2026-04-28; L4a₂
ERC-8004 read half specified 2026-04-28.

- Sections 1–10 (L4a₁): gateway Cloudflare Worker + `Reckon402Resolver`
  Solidity contract + ENS wiring + D1-backed static dispatch. Shipped
  under tag `L4a1-gateway-static-green-r2`. `ENABLE_ERC8004_READS=false`.
- Sections 11–17 (L4a₂): `@reckon402/erc-8004-client` library +
  gateway read-side integration + D1 reputation cache +
  cache-invalidation receive hook + reputation-tier pricing.
  `ENABLE_ERC8004_READS=true` on staging + production after L4a₂ ships.
  Write-side of the library is implemented but **not exercised live
  in this session** — L4b runs real writes.

Companion docs: `00_architecture.md` §3.3 (text-record schema),
`03-l3-our-facilitator.md` (stack mirror), `AGENTS.md ## L4a deployments`.

---

## 1. Purpose

The Gateway is the off-chain half of an ENS+CCIP-Read identity layer that
serves merchant text records (`x402.*`) to ENS-aware clients. In L4a₁ it
serves static records from a D1 table. In L4a₂ it will additionally read
ERC-8004 reputation to compute dynamic per-caller pricing.

**Cross-network awareness.** ENS lives on Ethereum. The Splitter we return
under `x402.splitter` lives on Base. The Gateway worker is Cloudflare edge.
Do not conflate the resolver contract (Ethereum) with the Splitter (Base).

---

## 2. Repository layout

```
gateway/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── README.md
│
├── src/
│   ├── index.ts               # Hono entrypoint
│   ├── env.ts                 # Env interface (CFW bindings)
│   ├── routes/
│   │   ├── lookup.ts          # POST /lookup + GET /lookup/:sender/:data
│   │   └── healthz.ts         # GET /healthz
│   ├── ccip/
│   │   ├── decode.ts          # callData → (name, callerAddr, key)
│   │   ├── sign.ts            # ezccip-style response signer
│   │   └── encode.ts          # ABI-encode resolver response
│   ├── resolution/
│   │   ├── dispatch.ts        # resolveRecord() — single modularity branch
│   │   └── records.ts         # D1-backed static lookup
│   ├── stealth/
│   │   └── .gitkeep           # DEFERRED — STEALTH_ENABLED=false always in L4a
│   └── lib/
│       └── errors.ts          # error taxonomy → HTTP status
│
├── migrations/
│   └── 0001_init.sql
│
├── test/
│   ├── unit/
│   └── integration/
│
└── scripts/
    └── seed_d1.ts
```

Solidity sources for the resolver live in the root `contracts/` Foundry
project alongside the L3 Splitter (single `lib/`, single `forge build`):

- `contracts/src/Reckon402Resolver.sol`
- `contracts/src/interfaces/IExtendedResolver.sol`
- `contracts/src/interfaces/IERC3668.sol`
- `contracts/test/Reckon402Resolver.t.sol`
- `contracts/script/DeployResolver.s.sol`

**Wrangler bindings:**

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 | `reckon402-d1-gateway-dev` (merchant config) |
| `RECKON402_RESOLVER_SIGNER_PK` | secret | Hot signer key for CCIP-Read response signing |
| `ETH_SEPOLIA_RPC_PRIMARY` | secret | Ethereum Sepolia RPC URL |
| `RESOLVER_CONTRACT_ADDRESS_SEPOLIA` | var | Deployed `Reckon402Resolver` on Sepolia |
| `ENABLE_ERC8004_READS` | var | `"false"` in L4a₁ |
| `STEALTH_ENABLED` | var | `"false"` always |

The gateway does **not** share a D1 instance with the facilitator.

---

## 3. Reckon402Resolver — Solidity contract

### 3.1 Custody analysis

`Ownable` is deliberate. Allowed mutators: `addSigner`, `removeSigner`,
`setGatewayUrls`, `transferOwnership`. No proxy, no upgrade hook, no
fallback that could repoint resolution.

The resolver holds **zero funds and zero settlement state**. The worst
Ownable abuse is mis-routing a buyer to the wrong `payTo` — which the
buyer's middleware catches via address-match pre-check, and the Splitter's
`distribute()` enforces the correct recipient set at settle time. The
immutability rule in AGENTS.md (`L3-our-facilitator-green`) applies to
settlement state; it does not apply to identity indirection. Signer
rotation rotates indirection only.

Compare with `Splitter.sol`: the Splitter holds USDC mid-settlement, so it
is admin-free by construction. The Resolver never holds value, so Ownable
is operationally correct and non-custodial.

### 3.2 Interface (Pattern A locked)

```solidity
contract Reckon402Resolver is IExtendedResolver, ERC165, Ownable {
    error OffchainLookup(address sender, string[] urls, bytes callData,
                         bytes4 callbackFunction, bytes extraData);
    error UnauthorizedSigner(address signer);
    error StaleResponse(uint64 timestamp, uint64 freshnessWindow);
    error MalformedCallData();

    mapping(address signer => bool authorized) public signers;
    string[] public gatewayUrls;
    uint64 public constant FRESHNESS_WINDOW = 300;  // seconds

    function resolve(bytes calldata name, bytes calldata data) external view;
    function resolveCallback(bytes calldata response, bytes calldata extraData)
        external view returns (bytes memory);
    function addSigner(address signer) external onlyOwner;
    function removeSigner(address signer) external onlyOwner;
    function setGatewayUrls(string[] calldata urls) external onlyOwner;
}
```

`resolve()` ABI-encodes `(name, msg.sender, data)` into both `callData`
and `extraData`, then reverts `OffchainLookup`. The caller's EOA is
embedded inside the payload (Pattern A). The `sender` field of
`OffchainLookup` is always `address(this)` — the resolver contract.

`resolveCallback()` decodes `(bytes data, uint64 timestamp, bytes32 nonce,
bytes sig)`, checks freshness, recovers signer, verifies `signers[recovered]`.
The signed digest is `keccak256(abi.encode(data, timestamp, nonce, extraData))`
wrapped in EIP-191 `"\x19Ethereum Signed Message:\n32"`.

### 3.3 Foundry test matrix (≥6 cases required)

| Test | Expected |
|------|---------|
| `test_resolve_revertsWithOffchainLookup` | always reverts |
| `test_resolve_callDataEncodesCallerEOA` | decoded callData contains msg.sender |
| `test_resolveCallback_validSig_returnsData` | happy path |
| `test_resolveCallback_unauthorizedSigner_reverts` | `UnauthorizedSigner` |
| `test_resolveCallback_staleTimestamp_reverts` | `StaleResponse` |
| `test_resolveCallback_corruptedExtraData_reverts` | recover fails → UnauthorizedSigner |
| `test_addSigner_notOwner_reverts` | `OwnableUnauthorizedAccount` |
| `test_setGatewayUrls_onlyOwner` | emits `GatewayUrlsUpdated` |
| `testFuzz_resolveCallback_anyValidSig` | succeeds for any fresh timestamp |

---

## 4. CCIP-Read gateway HTTP API

### 4.1 Routes

```
POST   /lookup                   # EIP-3668 canonical POST variant
GET    /lookup/:sender/:data     # URL-templated GET variant
OPTIONS /lookup                  # CORS preflight
GET    /healthz
```

CORS headers on all responses: `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Methods: GET, POST, OPTIONS`,
`Access-Control-Allow-Headers: Content-Type`.

### 4.2 Request / response shape

**POST /lookup request:**
```json
{ "sender": "0x<resolver-addr>", "data": "0x<abi-encoded-calldata>" }
```

`sender` is the **resolver contract address** (not the user EOA).  
The user EOA is encoded **inside `data`** by the resolver (Pattern A).

**200 response:**
```json
{ "data": "0x<abi-encoded-response>" }
```

The `data` field is ABI-encoded `(bytes result, uint64 timestamp,
bytes32 nonce, bytes sig)` — the exact shape the resolver's callback
expects.

### 4.3 Error codes

| HTTP | `code` | When |
|------|--------|------|
| 400 | `MALFORMED_CALL_DATA` | `data` doesn't ABI-decode |
| 400 | `UNKNOWN_NAME` | merchant not in D1 or `enabled=0` |
| 500 | `INTERNAL_ERROR` | catch-all |

### 4.4 healthz contract

Probes: `d1_records` (SELECT COUNT from merchants), `signing_key_loaded`
(env var non-null), `eth_sepolia_rpc` (getBlockNumber call).

Aggregate: `ok` if d1_records + signing_key pass; `degraded` if RPC ping
fails but others pass; `down` if signing key missing.

---

## 5. ENS text-record schema (gateway reader view)

For L4a₁ (static dispatch), all keys are served from D1 `merchants.records`
JSON column:

| Key | Value format |
|-----|-------------|
| `x402.facilitator` | URL string |
| `x402.splitter` | EVM address (checksummed) |
| `x402.endpoint` | URL string |
| `x402.scheme` | `"eip3009"` |
| `x402.version` | `"2"` |
| `x402.asset` | CAIP-19 asset identifier |
| `x402.pricing` | JSON `{discount_bps: number}` |
| `x402.attestation` | `"on"` \| `"off"` |
| `x402.yield` | `"morpho"` \| `"none"` |

In L4a₂, `x402.pricing` becomes dynamic (ERC-8004 reputation read). All
other keys remain static.

---

## 6. Resolution dispatch

```ts
// src/resolution/dispatch.ts
export async function resolveRecord(name: string, key: string, env: Env): Promise<string> {
  if (env.ENABLE_ERC8004_READS === 'true') {
    throw new Error('NOT_IMPLEMENTED — see L4a₂');
  }
  return staticLookup(name, key, env);
}
```

Single modularity branch. No factories, no strategy interfaces. The `if`
branch in L4a₁ is a single `throw`. L4a₂ replaces that line.

`staticLookup` reads from D1 `merchants` table, parses `records` JSON,
returns the value for the requested key. Returns `""` for an unknown key
(the ENS protocol treats absent text records as empty string).

---

## 7. D1 schema

```sql
-- migrations/0001_init.sql
CREATE TABLE merchants (
  ens_name    TEXT    PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 1,
  records     TEXT    NOT NULL,  -- JSON: {"x402.splitter": "0x...", ...}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE _healthz_probe (
  k  TEXT PRIMARY KEY,
  v  INTEGER NOT NULL
);
```

`records` is a flat JSON object. Keys are ENS text-record key strings.
Lookup: `JSON.parse(row.records)[key] ?? ""`.

Seed fixture name for tests: `seller.reckon402-test.eth`.

---

## 8. Signing

Gateway signs each response with a hot key (`RECKON402_RESOLVER_SIGNER_PK`).
Signature schema verbatim from ezccip.js TOR-variant:

```ts
const timestamp = BigInt(Math.floor(Date.now() / 1000));
const nonce = crypto.getRandomValues(new Uint8Array(32));
const digest = keccak256(encodeAbiParameters(
  [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }],
  [resultData, timestamp, nonce, extraData]
));
const ethDigest = keccak256(concat([
  toHex('\x19Ethereum Signed Message:\n32'),
  digest,
]));
const sig = await sign({ hash: ethDigest, privateKey: signerPk });
```

The signed payload is `abi.encode(resultData, timestamp, nonce, sig)`,
returned as the `data` field of the HTTP response.

---

## 9. Security properties

- **No raw key material** in logs, error responses, or HTTP headers.
- **FRESHNESS_WINDOW = 300s.** Resolver rejects responses older than 5 min.
- **Per-response nonce.** Replay within the freshness window returns the same
  correct answer (idempotent). Cross-name replay fails the digest check.
- **Signer rotation** is zero-downtime: add new signer → update Worker secret
  → wait ≥300s → remove old signer.

---

## 10. Open questions (read-only for L4a₁)

- ERC-8004 reader (`dispatch.ts` `if` branch) — resolved in L4a₂ (§11–§15).
- Reputation-tier pricing — resolved in L4a₂ (§13).
- D1 cache for ERC-8004 reads — resolved in L4a₂ (§14).
- Cache-invalidation hook (receive side) — resolved in L4a₂ (§15).
- ENS mainnet (`reckon402.eth`) — post-hackathon.
- Stealth derivation — permanently drop-flagged for hackathon.

---

# L4a₂ — ERC-8004 reads + reputation-tier pricing

The rest of this spec specifies L4a₂: the `@reckon402/erc-8004-client`
library, gateway read-side wiring, D1 reputation cache, cache-invalidation
receive hook, and reputation-tier pricing. Write-side of the library is
implemented but mocked-only in this session; L4b exercises real writes.

## 11. `@reckon402/erc-8004-client` — package shape

### 11.1 Layout

```
packages/erc-8004-client/
├── package.json              # name: @reckon402/erc-8004-client, private: false
├── tsconfig.json             # extends ../../tsconfig.base.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts              # public exports
│   ├── multichain.ts         # chain configs + canonical addresses (pinned)
│   ├── types.ts              # Agent, FeedbackEntry, ReputationSummary, ChainConfig
│   ├── cache.ts              # KVCache interface + NoopCache + LruCache
│   ├── identity.ts           # Identity R + W functions
│   ├── reputation.ts         # Reputation R + W functions
│   ├── validation.ts         # Validation R + W functions (forward-compat)
│   └── abis/
│       ├── identity.ts       # IDENTITY_ABI (minimal R+W subset)
│       ├── reputation.ts     # REPUTATION_ABI
│       └── validation.ts     # VALIDATION_ABI
└── test/
    ├── multichain.test.ts
    ├── identity.test.ts      # mocked viem
    ├── reputation.test.ts    # mocked viem + live Base Sepolia read
    ├── validation.test.ts    # mocked viem
    ├── cache.test.ts
    ├── abi-pinning.test.ts   # selector hash check vs pinned upstream SHA
    └── writes.test.ts        # wallet-client mocks; no live tx
```

### 11.2 Public exports (`src/index.ts`)

```ts
export { identity } from './identity.js'
export { reputation } from './reputation.js'
export { validation } from './validation.js'
export { getChainConfig, listSupportedChains, UPSTREAM_ABI_COMMIT } from './multichain.js'
export { NoopCache, LruCache } from './cache.js'
export type {
  Agent,
  FeedbackEntry,
  ReputationSummary,
  ValidationStatus,
  ChainConfig,
  KVCache,
} from './types.js'
```

Each domain (`identity`, `reputation`, `validation`) exports an object
whose methods take `{ chainId, publicClient, cache? }` for reads and
`{ chainId, walletClient }` for writes. Pure stateless helpers: no
module-level state, no factory functions, no class hierarchies.

### 11.3 Canonical types (`src/types.ts`)

```ts
export interface ChainConfig {
  chainId:                 number
  name:                    string
  identityRegistry:        `0x${string}` | null
  reputationRegistry:      `0x${string}` | null
  validationRegistry:      `0x${string}` | null  // null on all chains at commit 04633114
}

export interface Agent {
  agentId:   bigint
  owner:     `0x${string}`
  wallet:    `0x${string}`             // from getAgentWallet; may equal owner
  tokenURI:  string
}

export interface ReputationSummary {
  count:          bigint          // uint64 — number of feedback entries
  summaryValue:   bigint          // int128 — aggregate score, fixed-point
  decimals:       number          // uint8 — decimals for summaryValue
}

export interface FeedbackEntry {
  client:         `0x${string}`
  feedbackIndex:  bigint
  value:          bigint
  decimals:       number
  tag1:           string
  tag2:           string
  isRevoked:      boolean
}

export interface ValidationStatus {
  validator:      `0x${string}`
  agentId:        bigint
  response:       number
  responseHash:   `0x${string}`
  tag:            string
  lastUpdate:     bigint
}

export interface KVCache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}
```

### 11.4 Multichain config pinning

`src/multichain.ts` pins canonical registry addresses per chain. Values
taken from `github.com/erc-8004/erc-8004-contracts` master at commit
**`0463311492b3a7fc5fdb6990231cce721ff6cf97`**. This SHA is exported as
`UPSTREAM_ABI_COMMIT` so consumers can audit the drift against upstream
at any point.

| Chain | chainId | Identity | Reputation | Validation |
|-------|---------|----------|------------|------------|
| Base Sepolia | 84532 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `null` |
| Base Mainnet | 8453 | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `null` |
| Ethereum Sepolia | 11155111 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `null` |
| Ethereum Mainnet | 1 | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `null` |

Notes:

- **Base Sepolia + ETH Sepolia share the same Identity / Reputation
  addresses**; Base Mainnet + ETH Mainnet share a different pair. This
  is intentional and reflects upstream's deployment pattern (CREATE2
  with same salt across testnets vs. across mainnets).
- **`ValidationRegistry` is not deployed on any chain** at the pinned
  commit. The upstream repo marks it "under active discussion with TEE
  community". Library exposes the write/read API for forward-compat; all
  functions throw `VALIDATION_NOT_DEPLOYED` when `validationRegistry`
  is `null` on the target chain.
- Addresses are hardcoded constants, not env-configurable. If upstream
  redeploys at a new address, the next L4a₂-style session bumps
  `UPSTREAM_ABI_COMMIT` and the address table together.

### 11.5 ABI subset

`src/abis/*.ts` contain only the function + event entries the library
needs. Rationale: keeping the bundle small, making drift audits
tractable, and surfacing selector-change breakage immediately.

**Identity — functions kept:**

- Reads: `ownerOf(uint256)`, `tokenURI(uint256)`, `getAgentWallet(uint256)`, `getMetadata(uint256,string)`.
- Writes: `register()`, `register(string)`, `register(string,(string,bytes)[])`, `setAgentURI(uint256,string)`, `setMetadata(uint256,string,bytes)`, `setAgentWallet(uint256,address,uint256,bytes)`.
- Events: `Registered(uint256,string,address)`, `URIUpdated(uint256,string,address)`, `MetadataSet(uint256,string,string,bytes)`.

**Reputation — functions kept:**

- Reads: `getSummary(uint256,address[],string,string)`, `getClients(uint256)`, `getLastIndex(uint256,address)`, `getResponseCount(uint256,address,uint64,address[])`, `readFeedback(uint256,address,uint64)`, `readAllFeedback(uint256,address[],string,string,bool)`.
- Writes: `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)`, `revokeFeedback(uint256,uint64)`, `appendResponse(uint256,address,uint64,string,bytes32)`.
- Events: `NewFeedback`, `FeedbackRevoked`, `ResponseAppended`.

**Validation — functions kept:**

- Reads: `getValidationStatus(bytes32)`, `getSummary(uint256,address[],string)`, `getAgentValidations(uint256)`, `getValidatorRequests(address)`.
- Writes: `validationRequest(address,uint256,string,bytes32)`, `validationResponse(bytes32,uint8,string,bytes32,string)`.
- Events: `ValidationRequest`, `ValidationResponse`.

**Deviations from the M.0 handoff hints (documented for audit):**

| Handoff sketch | Upstream reality | Resolution |
|----------------|------------------|------------|
| `identity.getAgent(agentId)` | no such function | Library exposes `getAgent` as a helper that composes `ownerOf + getAgentWallet + tokenURI` into an `Agent`. |
| `AgentRegistered` event | upstream name is `Registered` | Library uses upstream name. |
| `FeedbackGiven` event | upstream name is `NewFeedback` | Library uses upstream name. |
| `reputation.giveFeedback(agentId, score, fileuri, filehash, tag1, tag2)` | upstream takes 8 args including `value:int128`, `valueDecimals:uint8`, `endpoint:string` | Library matches upstream 8-arg signature. |
| `validationRequest` takes `requestId` | upstream takes `(validator, agentId, requestURI, requestHash)` and keys subsequent reads by `requestHash` | Library matches upstream. |
| `agentId` reverse lookup from wallet | not exposed upstream | Library does **not** expose a wallet→agentId reverse lookup. Gateway resolves agents via ENS-indexed agentId (§13.2). |

### 11.6 Caller → agentId bridge (library-side)

The library does **not** take opinionated stance on EOA → agentId
bridging. Reads take `agentId` directly. The gateway (consumer) is
responsible for converting the caller's EOA into an agentId via its
own index — see §13.2.

### 11.7 Cache contract (`src/cache.ts`)

```ts
export interface KVCache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

// Library default — used when no cache passed.
export class NoopCache implements KVCache { /* returns null, writes vanish */ }

// In-memory LRU for local dev + unit tests.
export class LruCache implements KVCache { /* bounded Map with TTL */ }
```

Read functions accept an optional `cache?: KVCache`. When present,
`get(key)` is consulted first; on miss, the RPC read runs and the
result is written back with `set(key, JSON.stringify(result), ttlS)`.
The cache key format is `"erc8004:${chainId}:${contractAddress}:${fn}:${args}"`
where `args` is the SHA-256 of the JSON-serialized argument tuple. Hash
prevents cache-key bloat when `readAllFeedback` is called with large
address arrays.

## 12. Gateway integration (read-side wiring)

### 12.1 Layout

```
gateway/src/erc8004/
├── reader.ts                 # thin wrapper around @reckon402/erc-8004-client
├── cache.ts                  # D1-backed KVCache implementation
└── index.ts                  # barrel
```

### 12.2 `reader.ts` responsibilities

- Map `env` → `ChainConfig` via `BASE_SEPOLIA_RPC` / `BASE_MAINNET_RPC`.
- Instantiate a viem `PublicClient` per chain (memoized per request).
- Resolve the caller's ENS name → agentId via the `agentId_index` D1
  table (§13.2).
- Call `reputation.getSummary({ chainId, publicClient, cache })`
  with `clientAddresses: []`, `tag1: 'payment'`, `tag2: 'x402-settlement'`
  (per design doc §7.1).
- Instantiate and pass the D1-backed `KVCache` implementation.

### 12.3 `cache.ts` (D1 adapter)

Implements `KVCache` against the `erc8004_cache` D1 table:

```ts
export class D1Erc8004Cache implements KVCache {
  constructor(private db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        'SELECT value_json, expires_at FROM erc8004_cache WHERE cache_key = ? AND expires_at > ?',
      )
      .bind(key, Date.now())
      .first<{ value_json: string; expires_at: number }>()
    return row?.value_json ?? null
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000
    await this.db
      .prepare(
        `INSERT INTO erc8004_cache (cache_key, value_json, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at`,
      )
      .bind(key, value, expiresAt)
      .run()
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM erc8004_cache WHERE cache_key = ?').bind(key).run()
  }
}
```

On D1 errors (e.g., quota), `get` returns `null` (forces fresh read)
and `set` swallows the error with a `console.warn` — fall-back to
fresh-read mode. **Do not silently mask: log the warning.**

## 13. Dispatch flip + pricing

### 13.1 `dispatch.ts` after L4a₂

Single `if/else`, grown body. No factories.

```ts
export async function resolveRecord(
  ensName: string,
  key: string,
  env: Env,
): Promise<string> {
  if (env.ENABLE_ERC8004_READS === 'true') {
    const baseValue = await staticLookup(ensName, key, env.DB)
    if (key !== 'x402.amount' && key !== 'x402.pricing') return baseValue
    const agentId = await resolveAgentIdByEns(ensName, env.DB)
    if (agentId === null) return baseValue          // unknown-agent graceful fallback
    const reader = makeErc8004Reader(env)
    const summary = await reader.getReputationSummary(agentId)
    return applyPricingTier({ key, baseValue, summary })
  }
  return staticLookup(ensName, key, env.DB)
}
```

### 13.2 Agent-ID indexing (the minimal ENS→agentId bridge)

Design doc §7.2 specifies a D1 `agent_id_index` table. L4a₂ ships the
simplest workable shape:

```sql
-- migrations/0003_agent_id_index.sql (appended to 0002_erc8004_cache.sql commit)
CREATE TABLE IF NOT EXISTS agent_id_index (
  ens_name   TEXT PRIMARY KEY,
  chain_id   INTEGER NOT NULL,
  agent_id   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

Populated manually via `seed_d1.ts` for the demo merchants — the
`reckon402-test.eth` merchant maps to a known Base Sepolia agentId (see
`tools/integration-tests/known-agents.md`). Rows for unknown merchants
return `null` which triggers the graceful-fallback branch.

### 13.3 Reputation-tier pricing (`resolution/pricing.ts`)

Per design doc §6.2 (demo 3-call sequence). The v1 policy is a step
function of `summary.count`:

| count | discount (bps) | USDC price (base 0.10) | demo narration |
|-------|----------------|------------------------|----------------|
| 0 | 0 | 0.100 | default tier (fresh caller) |
| 1–2 | 500 | 0.095 | first-return tier |
| 3–9 | 1000 | 0.090 | repeat tier |
| ≥10 | 1500 | 0.085 | loyalty tier (asymptote) |

```ts
// gateway/src/resolution/pricing.ts
export function tierBpsFromCount(count: bigint): number {
  if (count === 0n) return 0
  if (count <= 2n) return 500
  if (count <= 9n) return 1000
  return 1500
}

export function applyPricingTier(args: {
  key:       'x402.amount' | 'x402.pricing'
  baseValue: string
  summary:   ReputationSummary
}): string {
  const bps = tierBpsFromCount(args.summary.count)
  if (args.key === 'x402.amount') {
    const amount = BigInt(args.baseValue)
    return ((amount * BigInt(10_000 - bps)) / 10_000n).toString()
  }
  const parsed = args.baseValue ? JSON.parse(args.baseValue) : {}
  return JSON.stringify({ ...parsed, discount_bps: bps })
}
```

`x402.amount` handling covers the L3 canonical price-unit convention
(integer USDC base-units); `x402.pricing` handles the legacy JSON
shape the design doc uses for the demo story. Both return the SAME
`summary.count`-derived tier — the keys exist because different
merchants publish the price in different ENS record shapes.

## 14. D1 migration `0002_erc8004_cache.sql`

```sql
-- migrations/0002_erc8004_cache.sql
-- L4a₂ — ERC-8004 read cache + agent-ID index

CREATE TABLE IF NOT EXISTS erc8004_cache (
  cache_key   TEXT    PRIMARY KEY,
  value_json  TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL          -- unix-ms deadline
);

CREATE INDEX IF NOT EXISTS idx_erc8004_cache_expires_at
  ON erc8004_cache (expires_at);

CREATE TABLE IF NOT EXISTS agent_id_index (
  ens_name    TEXT    PRIMARY KEY,
  chain_id    INTEGER NOT NULL,
  agent_id    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
```

Cache-key shape: `"erc8004:${chainId}:${contractAddress}:${fn}:${sha256(args)}"`.
Single-table cache (vs. §7.4 design-doc sketch with per-column
`caller_addr` / `rep_count`) — the library's KV abstraction wants
uniform serialization; pricing-tier math decodes the JSON at read
time. Forward-compat: if we ever need to query cache rows by agent
or fn, add an `agent_id INTEGER` column + index in a later migration.

## 15. Cache-invalidation receive hook

### 15.1 Route

```
POST /hooks/cache-invalidate
Content-Type: application/json
Authorization: Bearer <GATEWAY_CACHE_HOOK_TOKEN>

{ "agentId": 42, "chainId": 84532, "keys": ["reputation.getSummary"] }
```

### 15.2 Semantics

- Bearer token (`GATEWAY_CACHE_HOOK_TOKEN`) validated against an
  Infisical-managed shared secret. Constant-time compare.
- Body validation: `agentId` is a positive integer; `chainId` is in
  the supported chain set; `keys` is an array of lowercase function
  identifiers (`reputation.getSummary`, `identity.tokenURI`, etc.).
- Maps `(agentId, chainId, key)` → cache-key prefix and issues a
  `DELETE FROM erc8004_cache WHERE cache_key LIKE ?` with
  parameterized pattern matching on the prefix.
- Returns `200 { deleted: <rowCount> }` on success.
- 401 on auth failure; 400 on malformed body; 500 on D1 error.

### 15.3 What this session does NOT ship

The **call side** (facilitator POSTing to this hook after a confirmed
settle) is L4b scope. L4a₂ ships the receive side only — tested
end-to-end by Vitest integration tests that POST to the route with a
valid token.

## 16. Tests

### 16.1 Library (`packages/erc-8004-client/test/`, ≥8 unit)

1. `multichain.test.ts` — `getChainConfig(84532)` returns Base Sepolia entry; `getChainConfig(8453)` returns Base Mainnet; unknown chainId throws. `listSupportedChains()` lists exactly the four pinned chains.
2. `abi-pinning.test.ts` — every function in our Identity/Reputation/Validation subsets exists upstream at `UPSTREAM_ABI_COMMIT` (assertion via recomputing selector hashes against captured upstream bytes).
3. `identity.test.ts` — mocked viem: `identity.ownerOf`, `identity.tokenURI`, `identity.getAgentWallet`, `identity.getMetadata` each call the correct contract address and selector.
4. `identity.test.ts` (same file, second describe) — `identity.getAgent` composes three calls into an `Agent` struct.
5. `reputation.test.ts` — mocked viem: `reputation.getSummary` decodes `(count, summaryValue, decimals)` correctly; `reputation.readFeedback` decodes all 5 fields including `isRevoked`.
6. `reputation.test.ts` (live describe) — against real Base Sepolia RPC: `reputation.getSummary(knownAgentId, [], 'payment', 'x402-settlement')` returns a decodable summary. Cross-checks `summary.count` matches 8004scan.io snapshot taken at session start.
7. `cache.test.ts` — `LruCache` TTL: `set` then `get` within TTL returns value; `get` after TTL returns `null`. `NoopCache.get` always returns `null`. Library functions respect the optional cache arg.
8. `writes.test.ts` — `identity.register`, `reputation.giveFeedback`, `validation.validationRequest` each invoke `walletClient.writeContract` with the correct ABI + args. No live tx. Validation throws `VALIDATION_NOT_DEPLOYED` on Base Sepolia (null address).
9. `validation.test.ts` — `validation.getValidationStatus` on Base Sepolia throws `VALIDATION_NOT_DEPLOYED`. Decoding shape verified against a synthetic (mocked) publicClient.

### 16.2 Gateway (`gateway/test/`, ≥5 integration)

1. `erc8004-happy-path.test.ts` — flag=true; merchant row + agent_id_index seeded; `resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)` returns base 100000 when reputation summary count=0.
2. `erc8004-regression.test.ts` — flag=false; output byte-equal to L4a₁ tester output (`x402.facilitator` = `https://facilitator.reckon402.com`, `x402.splitter` = `0x0ad507c6973eba86313794329ad9b12fbf24acd0`).
3. `pricing-tier.test.ts` — flag=true; reputation summary count=1 → 500 bps discount applied; count=3 → 1000 bps; count=10 → 1500 bps.
4. `cache-hit.test.ts` — flag=true; first call writes D1 cache row; second call for same agentId hits cache (no additional RPC call recorded on the mocked publicClient).
5. `cache-invalidation.test.ts` — POST `/hooks/cache-invalidate` with valid token deletes the cache row; next resolution triggers fresh RPC read. 401 on missing/wrong token.
6. `unknown-agent-fallback.test.ts` — flag=true; merchant exists but no row in `agent_id_index` → return static `x402.amount` unchanged.

### 16.3 Tester (`tools/integration-tests/resolve-l4a.sh`)

Two backends, both exit 0 required:

```bash
./resolve-l4a.sh --backend static   # regression guard: output matches L4a₁ byte-for-byte
./resolve-l4a.sh --backend erc8004  # new path: live Base Sepolia read via staging gateway
```

The `--backend erc8004` path:
1. Queries `agent.reckon402-test.eth` (pre-seeded in `agent_id_index`).
2. Expects `x402.amount` to be pricing-tier adjusted based on the live
   reputation summary of the known Base Sepolia agent.
3. Asserts `value` is a decimal number string + `age` < 30s.

## 17. Deployment + wrangler bindings

Every new `[vars]` and new `[[d1_databases]]` block is **duplicated
under `[env.staging]` AND `[env.production]`** (L4a₁ lesson 1). Running
`wrangler deploy --env staging --dry-run` before any live deploy is
mandatory.

```toml
# gateway/wrangler.toml additions (duplicate under env.staging + env.production)
[vars]
ENABLE_ERC8004_READS       = "true"    # flip in L4a₂ deploy
BASE_SEPOLIA_RPC           = "${BASE_SEPOLIA_RPC}"   # overridden per-env
BASE_MAINNET_RPC           = ""         # placeholder; populated at L4b/mainnet
CACHE_TTL_REPUTATION_S     = "300"

# wrangler secret put:
#   GATEWAY_CACHE_HOOK_TOKEN     — shared with facilitator caller (L4b)
#   BASE_SEPOLIA_RPC             — if treated as secret (preferred)
```

## 18. Open questions (L4a₂)

- Validation registry address pinning — blocked on upstream
  deployment; surfaces `VALIDATION_NOT_DEPLOYED` in library.
- Facilitator → `/hooks/cache-invalidate` call side — L4b.
- Real writes via KMS signing wrapper — L4b.
- Reputation-gated resolution (gateway refuses to resolve if summary
  below threshold) — L4c demo.
- Full ENSIP-10 namehash end-to-end via UniversalResolver — Tier-2
  of L4a₂, deferred if budget tight.
