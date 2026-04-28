# 04 — L4a Gateway (CCIP-Read worker + wildcard resolver, static-dispatch)

**Status:** v1, locked, `ENABLE_ERC8004_READS=false` default. 2026-04-28.

Implements L4a₁ scope: gateway Cloudflare Worker + `Reckon402Resolver`
Solidity contract + ENS wiring + D1-backed static dispatch.  
ERC-8004 reader subcomponent deferred to L4a₂.

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

- ERC-8004 reader (`dispatch.ts` `if` branch) — L4a₂.
- Reputation-tier pricing — L4a₂.
- D1 cache for ERC-8004 reads — L4a₂.
- Cache-invalidation hook (receive side) — L4a₂.
- ENS mainnet (`reckon402.eth`) — post-hackathon.
- Stealth derivation — permanently drop-flagged for hackathon.
