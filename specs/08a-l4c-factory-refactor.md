# Spec 08A — L4c: SplitterFactory + facilitator per-payment splitter resolution

Status: implementation contract. Handoff-ready for a fresh execution agent.

Sources:
- `specs/06-actor-act-matrix.md` — D1–D14 locks; §4 act decomposition.
- `specs/07-l4b-erc8004-writes.md` — §4 env model, §5 attestation contract,
  §6 settle-route wiring (all of which this spec modifies).
- `contracts/src/Splitter.sol` — existing v1 Splitter (immutable, BPS-based,
  MAX_RECIPIENTS=8).
- `workers/facilitator/src/treasury/attestation.ts` — existing inline
  `ctx.waitUntil` attestation hook (L4b₁).
- Memory: `terminology.md` (SellingAgent / BuyingAgent / agentId),
  `l4c_scope_timeline.md` (30h budget, cut-priority), `ens_record_ownership_split.md`
  (x402.splitter is Reckon402-owned), `zktls_spike.md` (RED — no delivery-proof
  seam in L4c).

Companion: Spec 08B ships the onboarding script + signed-writes gateway +
frontend that consume this spec's factory + per-payment resolution.

---

## 1. Purpose and scope

Lift the single-`SPLITTER_ADDRESS`-per-facilitator constraint baked into L3
and carried through L4b₁. Deploy a `SplitterFactory` contract on Base
Sepolia; refactor the facilitator to resolve the per-SellingAgent Splitter
address at payment time from the `x402.splitter` ENS text record served by
the gateway. One facilitator serves N SellingAgents; each SellingAgent
owns their own Splitter deployed via CREATE2 through the factory.

This is the load-bearing substrate for the L4c neutral-router pitch. Spec
08B's onboarding script calls this spec's `createSplitter` as step 2 of 5.

**What Spec 08A ships:**

- `contracts/src/SplitterFactory.sol` — CREATE2 factory with
  `createSplitter(sellingAgent, recipients, bps, salt)`, emits
  `SplitterCreated(sellingAgent, splitter, salt)`.
- `contracts/src/SplitterFactory.t.sol` — forge tests covering happy path,
  deterministic address, duplicate-salt revert, input validation.
- `contracts/script/DeploySplitterFactory.s.sol` — foundry deploy script.
- `workers/facilitator/src/treasury/splitter-resolver.ts` — new module:
  `resolveSplitterForPayment(env, sellingAgentEns) → { splitter, agentId } | null`.
  Reads `x402.splitter` + `x402.erc8004.agent_id` from the gateway, validates
  `splitter` came from our factory (on-chain `isDeployed(splitter)` call).
- `workers/facilitator/src/treasury/agent-resolver.ts` — extended to accept
  ENS-driven input OR the legacy JSON-map fallback (behind flag, preserves
  L4b₁ regression).
- `workers/facilitator/src/settle-route.ts` — swap env `SPLITTER_ADDRESS`
  usage for `resolveSplitterForPayment` call. New error state
  `SPLITTER_UNKNOWN` for missing/forged records.
- `workers/facilitator/src/env.ts` + `wrangler.toml` — add `SPLITTER_FACTORY_ADDRESS`
  env, deprecate `SPLITTER_ADDRESS` (keep for L4b₁ regression flag only).
- `workers/facilitator/migrations/0003_l4c_splitter_factory.sql` — no new
  table; a config row in a (new) `deployment_config` kv table with
  `factory_address` and `block_deployed`.
- `workers/facilitator/test/splitter-resolver.test.ts` +
  `workers/facilitator/test/settle-route-factory.test.ts` + regression to
  `attestation.test.ts`.
- `AGENTS.md ## L4c SplitterFactory + per-payment resolution` section.

**What Spec 08A does NOT ship** (these are Spec 08B's scope):

- No onboarding script.
- No signed-writes gateway admin endpoints.
- No frontend template.
- No new ENS subname minting logic (the factory creates Splitters; Spec 08B
  writes the ENS records that point at them).
- No `x402.pricing` tier editor.
- No zkTLS / delivery-proof anything (zkTLS spike RED per `zktls_spike.md`;
  `feedbackHash` shape unchanged from Spec 07 §5.3).

---

## 2. Actor / act extensions (cross-ref matrix §4)

New acts introduced by this spec. Matrix D-decisions unchanged.

| Act | Off-chain / on-chain | Signer | Broadcaster | Gas payer |
|-----|----------------------|--------|-------------|-----------|
| A12. Broadcast `SplitterFactory.createSplitter(...)` | on-chain | Reckon402 deployer key | Reckon402 deployer | Reckon402 (covered by funder EOA) |
| A13. Read `SplitterFactory.isDeployed(address)` | off-chain (RPC) | n/a | n/a | n/a |
| A14. Read `x402.splitter` ENS text record (facilitator, per-payment) | off-chain (gateway HTTP) | n/a | n/a | n/a |

A12 runs once per SellingAgent onboarding (Spec 08B's onboarding script).
A13 + A14 run once per payment inside the facilitator settle path.

Nothing else changes. Facilitator still signs `transferWithAuthorization`
(A2), `Splitter.distribute` (A3), and `giveFeedback` (A4) with
`FACILITATOR_PK`; `clientAddress` on the attestation is still the
facilitator EOA per D3.

---

## 3. Contract surface

### 3.1 `SplitterFactory.sol`

Location: `contracts/src/SplitterFactory.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Splitter } from "./Splitter.sol";

/// @title  Reckon402 SplitterFactory (v1)
/// @notice Deploys per-SellingAgent Splitters via CREATE2.
/// @dev    No admin, no upgrade. Salt is caller-chosen to let the
///         onboarding script pick addresses that are unique per
///         (sellingAgentEns, chainId).
contract SplitterFactory {
    IERC20 public immutable token;

    mapping(address => bool) public isDeployed;

    event SplitterCreated(
        address indexed sellingAgent,    // slot 0 recipient
        address indexed splitter,
        bytes32 indexed salt,
        address[]       recipients,
        uint16[]        bps
    );

    error AlreadyDeployed(address splitter);
    error InvalidSellingAgent();

    constructor(IERC20 _token) {
        token = _token;
    }

    /// @notice Deploy a new Splitter for `sellingAgent`. Reverts if the
    ///         deterministic address is already deployed (repeated salt).
    /// @param  sellingAgent    MUST equal recipients[0] (slot 0 = seller
    ///                         by L3 Splitter convention).
    /// @param  recipients      1–8 addresses; recipients[0] is the
    ///                         SellingAgent wallet.
    /// @param  bps             BPS per recipient, sums to 10_000.
    /// @param  salt            Caller-chosen; typically keccak256(ensName).
    /// @return splitter        Deterministic deployed address.
    function createSplitter(
        address           sellingAgent,
        address[] memory  recipients,
        uint16[]  memory  bps,
        bytes32           salt
    ) external returns (address splitter) {
        if (recipients.length == 0 || recipients[0] != sellingAgent) {
            revert InvalidSellingAgent();
        }

        address predicted = predictAddress(salt, recipients, bps);
        if (isDeployed[predicted]) revert AlreadyDeployed(predicted);

        splitter = address(new Splitter{salt: salt}(token, recipients, bps));
        // `splitter == predicted` by CREATE2 math; we still write `splitter`
        // (not `predicted`) to avoid assuming equality if a toolchain
        // optimizes constructor args.
        isDeployed[splitter] = true;

        emit SplitterCreated(sellingAgent, splitter, salt, recipients, bps);
    }

    /// @notice Compute the CREATE2 address for given salt + constructor args.
    /// @dev    Read-only; callers use this to pre-compute the Splitter address
    ///         before deploying (e.g., to pre-fill ENS `x402.splitter`).
    function predictAddress(
        bytes32           salt,
        address[] memory  recipients,
        uint16[]  memory  bps
    ) public view returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(Splitter).creationCode,
            abi.encode(token, recipients, bps)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(creationCode)
            )
        );
        return address(uint160(uint256(hash)));
    }
}
```

### 3.2 Factory-level invariants (forge tests assert)

- `createSplitter` with same `salt` twice reverts `AlreadyDeployed`.
- `recipients[0] != sellingAgent` reverts `InvalidSellingAgent`.
- `predictAddress` equals the actual deployed address (round-trip check).
- Deployed Splitter's constructor-level invariants still hold (BPS sums to
  10_000, no zero addresses, 1 ≤ n ≤ 8 recipients) — these revert inside
  `Splitter.constructor`, not at factory level; the factory just bubbles.
- `isDeployed[splitter] == true` after successful deploy; `false` for any
  random address.
- `SplitterCreated` event emitted with exact arg order.

### 3.3 CREATE2 salt convention

Caller-chosen. Spec 08B's onboarding script uses:

```
salt = keccak256(abi.encodePacked(sellingAgentEnsName))
```

Picks a unique address per ENS subname. Re-onboarding a name with the
same recipients would revert `AlreadyDeployed` — intentional (forces the
operator to change recipients or salt, preventing accidental re-deploys
that overwrite state).

---

## 4. Facilitator refactor

### 4.1 New module — `workers/facilitator/src/treasury/splitter-resolver.ts`

Purpose: resolve `(splitter, agentId)` pair from the gateway for the
SellingAgent identified on an incoming payment. Validates that the returned
splitter address was actually deployed by our factory (not a forged ENS
record).

```ts
import { createPublicClient, http, getAddress, isAddress, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { makeLogger } from '@reckon402/logger'

const log = makeLogger('splitter-resolver')

export interface SplitterResolverEnv {
  BASE_SEPOLIA_RPC_PRIMARY: string
  SPLITTER_FACTORY_ADDRESS: string
  GATEWAY_BASE_URL: string           // e.g. https://gateway.reckon402.com
  ERC8004_CHAIN_ID: string            // "84532" for Base Sepolia
}

export interface ResolvedSplitter {
  splitter: `0x${string}`
  agentId: bigint
  ensName: string
}

/**
 * Resolve the Splitter + agentId for a SellingAgent identified by ENS name.
 *
 * Reads via gateway (L4a₂ ENS resolution path):
 *   GET  {GATEWAY_BASE_URL}/lookup/{ensName}/x402.splitter?backend=static
 *   GET  {GATEWAY_BASE_URL}/lookup/{ensName}/x402.erc8004.agent_id?backend=static
 *
 * Validates splitter came from our SplitterFactory by calling
 * SplitterFactory.isDeployed(splitter). Returns null on ANY failure
 * (missing record, malformed value, factory rejection, RPC error).
 * Null is a SOFT skip — the caller converts it to an explicit
 * SPLITTER_UNKNOWN state for the payment.
 *
 * Never throws. Logs structured errors instead.
 */
export async function resolveSplitterForPayment(
  env: SplitterResolverEnv,
  ensName: string,
): Promise<ResolvedSplitter | null> {
  // Fetch both records in parallel.
  const [splitterRaw, agentIdRaw] = await Promise.all([
    fetchRecord(env.GATEWAY_BASE_URL, ensName, 'x402.splitter'),
    fetchRecord(env.GATEWAY_BASE_URL, ensName, 'x402.erc8004.agent_id'),
  ])
  if (!splitterRaw || !agentIdRaw) {
    log.warn('resolve_missing_record', { ensName, splitterRaw, agentIdRaw })
    return null
  }

  // Validate splitter shape.
  if (!isAddress(splitterRaw)) {
    log.warn('resolve_invalid_splitter_format', { ensName, splitterRaw })
    return null
  }
  const splitter = getAddress(splitterRaw) as `0x${string}`

  // Validate agentId shape.
  let agentId: bigint
  try {
    agentId = BigInt(agentIdRaw)
    if (agentId <= 0n) throw new Error('non-positive')
  } catch {
    log.warn('resolve_invalid_agent_id', { ensName, agentIdRaw })
    return null
  }

  // Factory membership check.
  const chainId = Number(env.ERC8004_CHAIN_ID)
  if (chainId !== 84532) {
    log.error('resolve_unsupported_chain', { chainId })
    return null
  }

  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(env.BASE_SEPOLIA_RPC_PRIMARY),
    })
    const deployed = await client.readContract({
      address: env.SPLITTER_FACTORY_ADDRESS as `0x${string}`,
      abi: FACTORY_ABI_MIN,
      functionName: 'isDeployed',
      args: [splitter],
    })
    if (!deployed) {
      log.warn('resolve_splitter_not_from_factory', { ensName, splitter })
      return null
    }
  } catch (err) {
    log.error('resolve_factory_rpc_error', {
      ensName,
      error: (err as Error).message,
    })
    return null
  }

  return { splitter, agentId, ensName }
}

async function fetchRecord(
  gatewayUrl: string,
  ensName: string,
  key: string,
): Promise<string | null> {
  const url =
    `${gatewayUrl}/lookup/${encodeURIComponent(ensName)}/` +
    `${encodeURIComponent(key)}?backend=static`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return null
    const body = (await res.json()) as { value?: string } | null
    const v = body?.value?.trim()
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

const FACTORY_ABI_MIN = [
  {
    type: 'function',
    name: 'isDeployed',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
```

**Exact test discipline** (per `feedback_testing.md`): every mock call
asserts full args, not just call count.

### 4.2 Settle-route integration

File: `workers/facilitator/src/settle-route.ts`.

Current (L4b₁) flow uses `c.env.SPLITTER_ADDRESS` as a singleton. Replace
with a per-payment resolution. The SellingAgent ENS name is derived from
the payment's destination (payload carries `to` or `merchantEnsName`; see
payment schema below).

**Incoming payment identification:** the x402 `X-Payment` header decoder
already yields the merchant's ENS name via `paymentRequirements.extra.ens`
(L4a₂ convention). Extract and pass to `resolveSplitterForPayment`.

**New state transition** in `state-machine.ts`:

- Existing: `INIT → AUTHORIZED → CONFIRMED` (happy), `→ FAILED` (any error).
- Added: after `AUTHORIZED`, before broadcasting `transferWithAuthorization`,
  insert a splitter-resolution check. If `resolveSplitterForPayment` returns
  null, transition to `SPLITTER_UNKNOWN` (new terminal state) and return
  HTTP 422 with `{error: "splitter_unknown", ensName}`.

**Why HTTP 422 (not 400 or 500):** the request is syntactically valid but
semantically unprocessable (no splitter for this SellingAgent). 422 is the
canonical HTTP signal for this.

**Code sketch for the settle-route body:**

```ts
// After AUTHORIZED is written, before transferWithAuthorization broadcast:
const ensName = paymentRequirements.extra?.ens
if (!ensName) {
  // Defensive: settle-route already validated this upstream at L4a₂,
  // but keep the guard.
  return c.json({ error: 'missing_ens' }, 400)
}

const resolved = await resolveSplitterForPayment(
  {
    BASE_SEPOLIA_RPC_PRIMARY: c.env.BASE_SEPOLIA_RPC_PRIMARY,
    SPLITTER_FACTORY_ADDRESS: c.env.SPLITTER_FACTORY_ADDRESS,
    GATEWAY_BASE_URL: c.env.GATEWAY_BASE_URL,
    ERC8004_CHAIN_ID: c.env.ERC8004_CHAIN_ID,
  },
  ensName,
)
if (!resolved) {
  await c.env.DB
    .prepare(`UPDATE receipts SET state = 'SPLITTER_UNKNOWN' WHERE payment_id = ?1`)
    .bind(paymentId)
    .run()
  return c.json({ error: 'splitter_unknown', ensName }, 422)
}

// Use resolved.splitter instead of c.env.SPLITTER_ADDRESS from here on.
// settle.ts's distribute() call takes splitter as a parameter.
```

### 4.3 `agent-resolver.ts` change

File: `workers/facilitator/src/treasury/agent-resolver.ts`.

Current behaviour (L4b₁): reads `x402.splitter` → `Splitter.getRecipient(0)`
→ lookup in `SELLER_AGENT_IDS` JSON map.

New behaviour: take agentId directly from `resolveSplitterForPayment`'s
return value (which already read it from the gateway). Legacy JSON-map path
stays as fallback behind env flag `USE_LEGACY_AGENT_RESOLVER=true` for
L4b₁ regression tests. In L4c prod, `USE_LEGACY_AGENT_RESOLVER=false`.

```ts
export async function resolveAgentIdForAttestation(
  env: AgentResolverEnv,
  resolved: ResolvedSplitter | null,   // passed in from settle-route
): Promise<bigint | null> {
  if (resolved) return resolved.agentId  // L4c path
  if (env.USE_LEGACY_AGENT_RESOLVER !== 'true') return null
  return resolveAgentIdLegacy(env)       // existing L4b₁ JSON-map path
}
```

The attestation write (`maybeWriteAttestation` in `attestation.ts`)
receives `agentId` via `resolved` — no change needed inside attestation
logic itself. The delivery-proof seam discussed in earlier `zktls_spike.md`
is NOT added; `feedbackHash` shape stays exactly as Spec 07 §5.3.

### 4.4 settle.ts distribute call

File: `workers/facilitator/src/settle.ts`.

Currently `distribute()` reads `env.SPLITTER_ADDRESS`. Refactor to accept
`splitter: \`0x\${string}\`` as a function argument. Caller (settle-route)
passes `resolved.splitter`.

No other changes to settle.ts logic. Balance-poll + explicit gas=300_000n
(per `project_status.md` L3 key fix) remain unchanged.

---

## 5. Env + secrets

### 5.1 New env vars (`wrangler.toml [vars]`)

| Var | Default | Purpose |
|-----|---------|---------|
| `SPLITTER_FACTORY_ADDRESS` | `""` (deploy-time) | Address of the deployed SplitterFactory on Base Sepolia. Filled after contract deploy, before `ENABLE_L4C_FACTORY` flip. |
| `GATEWAY_BASE_URL` | `"https://gateway.reckon402.com"` | Gateway for `x402.splitter` / `x402.erc8004.agent_id` lookups. |
| `ENABLE_L4C_FACTORY` | `"false"` | Master switch. `false` = use legacy `SPLITTER_ADDRESS` env var (L4b₁ behavior). `true` = use per-payment resolution. |
| `USE_LEGACY_AGENT_RESOLVER` | `"true"` | Keeps L4b₁ agent-resolver test fixtures green while L4c lands. Set to `"false"` after smoke-ok. |

### 5.2 Deprecated (kept for L4b₁ regression only)

| Var | Status |
|-----|--------|
| `SPLITTER_ADDRESS` | Deprecated. Used only when `ENABLE_L4C_FACTORY=false`. Remove post-L4c smoke. |
| `SELLER_AGENT_IDS` | Deprecated. Used only when `USE_LEGACY_AGENT_RESOLVER=true`. |

### 5.3 Secrets

None new. `BASE_SEPOLIA_RPC_PRIMARY` already present.

---

## 6. D1 schema delta (migration 0003)

File: `workers/facilitator/migrations/0003_l4c_splitter_factory.sql`.

```sql
-- L4c: track which SplitterFactory deployment is authoritative for this
-- facilitator worker instance. Used for audit + cold-start logging.
-- No hot-path queries; written once at deploy time, read once at boot.

CREATE TABLE IF NOT EXISTS deployment_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- New receipts.state value: 'SPLITTER_UNKNOWN'.
-- SQLite has no enum; the existing `state` column is TEXT with a
-- documented allowlist. Update the allowlist in state-machine.ts.
```

The `deployment_config` table holds one row at deploy time:

```sql
INSERT OR REPLACE INTO deployment_config (key, value, updated_at)
VALUES ('splitter_factory_address', '0x...', strftime('%s','now')*1000);
```

The exec script `just deploy-splitter-factory` writes this row.

**No new index.** No new column on `receipts` or `attestations`.

---

## 7. Test plan

### 7.1 Forge — `contracts/test/SplitterFactory.t.sol`

| # | Case | Asserts |
|---|------|---------|
| 1 | Happy path | `createSplitter` with valid args deploys; `isDeployed[addr] == true`; event emitted with exact args; deployed address matches `predictAddress` |
| 2 | Duplicate salt | Second `createSplitter` with same salt reverts `AlreadyDeployed(addr)` |
| 3 | sellingAgent != recipients[0] | Reverts `InvalidSellingAgent` |
| 4 | Empty recipients | Reverts `InvalidSellingAgent` (length==0 check) |
| 5 | BPS != 10_000 | Bubbles `Splitter.InvalidBpsSum` from inner constructor |
| 6 | Zero address in recipients | Bubbles `Splitter.ZeroAddress` |
| 7 | > 8 recipients | Bubbles `Splitter.InvalidRecipientCount` |
| 8 | `predictAddress` round-trip | Pre-computed address equals deployed address for random salt + arbitrary valid args |
| 9 | `isDeployed` default false | For any random address not deployed by this factory, returns false |
| 10 | Fuzz on salt | 256-case fuzz: salt → predicted → deploy → assert equality, no duplicates |

### 7.2 Vitest — `workers/facilitator/test/splitter-resolver.test.ts`

Module under test: `resolveSplitterForPayment`. Mock `fetch` for gateway,
mock viem `createPublicClient.readContract` for factory check.

| # | Case | Asserts |
|---|------|---------|
| 1 | Happy path | Returns `{splitter, agentId, ensName}`; both fetches called with exact URLs; factory `isDeployed` called with exact address |
| 2 | Gateway 404 on splitter record | Returns null; logs `resolve_missing_record` |
| 3 | Gateway 404 on agent_id record | Returns null; logs `resolve_missing_record` |
| 4 | Malformed splitter (not hex address) | Returns null; logs `resolve_invalid_splitter_format` |
| 5 | agent_id = "0" | Returns null (non-positive) |
| 6 | agent_id non-numeric | Returns null |
| 7 | Factory `isDeployed` returns false | Returns null; logs `resolve_splitter_not_from_factory` |
| 8 | Factory RPC throws | Returns null; logs `resolve_factory_rpc_error`; never re-throws |
| 9 | Checksum normalization | splitter input `0xabc…` (lowercase) → output matches `getAddress(input)` |
| 10 | Parallel fetch discipline | Both `fetch` calls issued before any `await` on their responses (assert via `Promise.all` shape) |

### 7.3 Vitest — `workers/facilitator/test/settle-route-factory.test.ts`

| # | Case | Asserts |
|---|------|---------|
| 1 | `ENABLE_L4C_FACTORY=false`, happy path | Uses `env.SPLITTER_ADDRESS`; no call to `resolveSplitterForPayment` |
| 2 | `ENABLE_L4C_FACTORY=true`, resolver returns null | Writes `state='SPLITTER_UNKNOWN'` to D1; responds HTTP 422 with body `{error:'splitter_unknown', ensName}`; never broadcasts transferWithAuthorization |
| 3 | `ENABLE_L4C_FACTORY=true`, resolver happy | Passes `resolved.splitter` into `settle.ts.distribute`; agentId arrives in `maybeWriteAttestation` correctly |
| 4 | State machine allowlist | `SPLITTER_UNKNOWN` is a recognized state; not in the retry-reconciler's sweep scope |
| 5 | Regression: L4b₁ attestation happy path unchanged | With L4C flags off, identical tx hashes on a deterministic fixture |

### 7.4 Attestation regression — `workers/facilitator/test/attestation.test.ts`

Existing L4b₁ tests MUST continue passing with no arg changes. Add **one new
case:**

| # | Case | Asserts |
|---|------|---------|
| 10 | L4c path: `resolved` provides agentId directly | `maybeWriteAttestation` calls `reputation.giveFeedback` with agentId from `resolved`, NOT from `SELLER_AGENT_IDS` map; JSON-map is never consulted |

### 7.5 Integration smoke — `tools/integration-tests/full-flow-l4c-factory.sh`

End-to-end: deploy factory, deploy a test Splitter via factory, seed a
fake merchant's `x402.splitter` + `x402.erc8004.agent_id` records directly
in the gateway D1 (bypassing Spec 08B's onboarding script), run a paid
call, assert:
- settle-route returns 200
- settlement tx lands
- attestation tx lands
- `receipts.td_erc8004_tx` populated
- gateway cache-invalidate fires

Also: flip `x402.splitter` to a random non-factory address; re-run the same
call; assert HTTP 422 `splitter_unknown` and no on-chain tx.

---

## 8. Deployment checklist

1. `forge test --match-contract SplitterFactory` → 10/10 green.
2. `forge script DeploySplitterFactory.s.sol:DeploySplitterFactory --rpc-url $BASE_SEPOLIA_RPC --broadcast` → capture `SplitterFactory` address.
3. Apply `0003_l4c_splitter_factory.sql` to `reckon402-d1-facilitator-dev`.
4. `just` recipe: `deploy-splitter-factory` writes the factory address into `deployment_config` + prints to stdout + updates `wrangler.toml [vars] SPLITTER_FACTORY_ADDRESS`.
5. `wrangler deploy --env staging` with `ENABLE_L4C_FACTORY="false"`. Regression: `full-flow-l4b.sh` still PASS.
6. Flip `ENABLE_L4C_FACTORY="true"`. Run `full-flow-l4c-factory.sh`. PASS required.
7. Flip `USE_LEGACY_AGENT_RESOLVER="false"`. Re-run `full-flow-l4c-factory.sh`.
8. Push annotated tag `L4c-factory-green`.
9. Update `AGENTS.md ## L4c SplitterFactory + per-payment resolution` with tx URLs + version IDs.

---

## 9. Open questions

**Q-08A-1 — Splitter per-payment vs Splitter per-SellingAgent.** Current
spec: one Splitter per SellingAgent, resolved once per payment. Alternative:
one Splitter per payment (CREATE2 with paymentId salt) for maximum
auditability. Rejected for hackathon — gas cost per payment balloons and
the audit-per-Splitter claim is not load-bearing for the L4c pitch. v1.5
revisit when dispute flows need it.

**Q-08A-2 — Factory upgrade path.** This spec deploys V1 factory; V2
factory would deploy V2 Splitter with new recipient-count limits or fee
schedules. V1 SellingAgents keep their V1 Splitters. Spec 08A does not
address V2; Uniswap V3 factory-versioning is the reference.

**Q-08A-3 — Factory ownership.** Current design: no owner, fully
permissionless. Anyone with gas can call `createSplitter`. Concern: spam
deployment. Not a hackathon concern (gas is cheap on Base Sepolia). v1.5
may add `onlyReckon402` modifier if onboarding throughput becomes a
product surface.

**Q-08A-4 — Gateway cache for `x402.splitter`.** Gateway currently caches
reputation reads (L4a₂); does it cache static text records? Verify before
wiring — if not, we add a short TTL or rely on D1 response latency.

---

## 10. Definition of done

- [ ] `contracts/src/SplitterFactory.sol` committed + deployed on Base Sepolia.
- [ ] `contracts/test/SplitterFactory.t.sol` 10/10 green in forge.
- [ ] `contracts/script/DeploySplitterFactory.s.sol` reproducible from clean `forge build`.
- [ ] `workers/facilitator/src/treasury/splitter-resolver.ts` implemented per §4.1 with 10/10 vitest green, all asserts on full arg shapes.
- [ ] `workers/facilitator/src/settle-route.ts` refactored per §4.2.
- [ ] `workers/facilitator/src/treasury/agent-resolver.ts` extended per §4.3; L4b₁ regression test fixtures unchanged.
- [ ] `workers/facilitator/src/settle.ts` accepts `splitter` as arg, not from env.
- [ ] `workers/facilitator/migrations/0003_l4c_splitter_factory.sql` applied.
- [ ] `ENABLE_L4C_FACTORY` flag-off deploy: L4b₁ regression PASS.
- [ ] `ENABLE_L4C_FACTORY` flag-on deploy + `full-flow-l4c-factory.sh` PASS (including 422 forged-splitter case).
- [ ] `AGENTS.md ## L4c SplitterFactory + per-payment resolution` section committed.
- [ ] Annotated tag `L4c-factory-green` pushed.

---

## 11. Hour budget (from `l4c_scope_timeline.md`)

10h total for this spec:
- `SplitterFactory.sol` + forge tests + deploy script: 3h
- `splitter-resolver.ts` + vitest: 2h
- `settle-route.ts` + `settle.ts` refactor + vitest: 2h
- Agent-resolver extension + attestation.test.ts regression: 1h
- D1 migration + wrangler vars + deploy + smoke: 1h
- Regression repair buffer (Spec 07 smoke tests break on env format): 1h

Zero slack. If we hit 13h, trigger scope-cut priority order per
`l4c_scope_timeline.md`.

---

## 12. References

- `specs/06-actor-act-matrix.md` — D1–D14 locks; matrix §4.
- `specs/07-l4b-erc8004-writes.md` — §4 env model, §5 attestation contract.
- `contracts/src/Splitter.sol` — existing Splitter v1.
- `workers/facilitator/src/treasury/attestation.ts` — L4b₁ attestation hook.
- `workers/facilitator/src/settle.ts` + `settle-route.ts` — L3/L4b₁ settlement path.
- Memory index: `terminology.md`, `l4c_scope_timeline.md`, `ens_record_ownership_split.md`, `zktls_spike.md`, `demo_narrative.md`, `post_hackathon_delivery_proof.md`.
