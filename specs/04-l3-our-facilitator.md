# Spec 04 — L3: Splitter contract + Reckon402 Facilitator + 3 workspace packages

Status: implementation contract.
Sources: design pack `01_splitter.md` (full), `02_facilitator.md` §3, §6, §7, §8, §9, §11, §12, §13;
`00_architecture.md` §3.4, §4.3; `alignment_decisions.md`; live `AGENTS.md`;
live `specs/03-l2-x402-paywall.md` (wire format + `Facilitator` interface — referenced, not duplicated).

L3 writes ON TOP of L2: the wire format, `PaymentRequirements` / `PaymentPayload` / `SettlementResponse` shapes,
the `Facilitator` interface (verify + settle), the 402 gate, and the middleware flow are all defined by
spec 03. L3 adds the on-chain Splitter, the Reckon402 Facilitator worker, three workspace packages that
graduate L2's inline worker modules, and swaps the agent worker to consume our facilitator via config.

---

## 1. Purpose and scope

Ship the verify+settle path that Reckon402 owns end-to-end:

- **Splitter contract** on Base Sepolia, deployed by the KMS deployer EOA.
- **Reckon402 Facilitator** worker at `facilitator.reckon402.com` (Hono + Cloudflare Workers + D1),
  implementing the HTTP API from design pack `02_facilitator.md` §4 (already documented — L3 is the
  first implementation).
- **Three workspace packages** (`@reckon402/facilitator-client`, `@reckon402/middleware-hono`,
  `@reckon402/buyer-sdk`) that lift L2's inline worker modules into reusable libraries, consumed via
  `workspace:*`.
- **agent.reckon402.com swap** — the agent worker replaces `CdpFacilitator` with `Reckon402Facilitator`.
  The middleware code does NOT change; the swap is a single constructor-call edit plus wrangler env
  vars. The L2 middleware tests (which lock in the `EXPECTED_REQUIREMENTS` pattern the facilitator
  receives) MUST continue to pass unchanged — that is the regression gate.
- **Live full-flow + replay tests** on Base Sepolia.

**Out of scope at L3 (deferred to H-7 polish or L4):** ERC-8004 attestation writes (§10.2 —
`attestations` table schema ships at L3, INSERT path is L4); Morpho deposit (§10.3 — deferred per
AGENTS.md Lane IV); ERC-1271 / SCA support (§4.1 step 5); real reconciler sweep (§9 — stub only at L3);
gateway / ENS / CCIP-Read (L4); signing wrapper + KeeperHub skill (L4).

---

## 2. Splitter contract

### 2.1 Solidity interface (verbatim from `01_splitter.md` §2)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Splitter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint8  public immutable totalRecipients;
    uint16 public constant  BPS_DENOMINATOR = 10_000;
    uint8  public constant  MAX_RECIPIENTS  = 8;

    // 8 immutable recipient/bps slots (r0..r7, b0..b7) — read via getRecipient(slot)
    // Full storage body in contracts/src/Splitter.sol; spec omits the repeat here.

    event Distributed(
        bytes32 indexed paymentId,
        uint8   indexed slot,
        address indexed recipient,
        uint16  bps,
        uint256 amount
    );
    event Deployed(address indexed token, uint8 totalRecipients, address[] recipients, uint16[] bps);

    error InvalidRecipientCount();
    error InvalidBpsSum(uint256 actual);
    error ZeroAddress(uint8 slot);
    error InsufficientBalance(uint256 requested, uint256 available);
    error InvalidSlot(uint8 slot);

    constructor(IERC20 _token, address[] memory _recipients, uint16[] memory _bps);

    /// Anyone can call. Splitter must hold >= amount of token.
    function distribute(bytes32 paymentId, uint256 amount) external;

    function getRecipient(uint8 slot) public view returns (address, uint16);
    function getAllRecipients() external view returns (address[] memory, uint16[] memory);
}
```

Key invariants (from §1.3 and §3):

- **All state immutable.** No admin. No upgrade. No rescue. No `paymentId` replay protection on-chain
  (that lives in the facilitator's D1 UNIQUE constraint).
- `sum(bps) == BPS_DENOMINATOR (10_000)` enforced in constructor.
- `distribute()` is permissionless (anyone can call). Frontrunning is acceptable (§8.4): funds go to
  the correct recipients per BPS either way; facilitator reconciles on the observed `Distributed`
  events, not on its own tx receipt.
- Rounding dust (≤ `totalRecipients` wei = 8 wei max) stays in the contract and is swept on the next
  `distribute()` call.
- `safeTransfer` is used from OpenZeppelin 5.3.0's `SafeERC20` (`using SafeERC20 for IERC20`). No
  custom `nonReentrant` modifier — USDC is well-behaved (no ERC-777 hooks); state reads precede the
  transfer loop and no state is written inside it.

### 2.2 Forward-compat for F11 (ERC-1155 wrapper)

Pattern 2 per §5: `getRecipient(slot)` is the hook. v1 contract is immutable; the v2 ERC-1155
wrapper is a separate deployable. Merchants who want F11 deploy v1 with the wrapper address in the
intended slot from day 1. **No v1 surface changes required for v2.** L3 ships v1 only.

### 2.3 Gas profile targets (from §4)

| Operation | Target gas |
|-----------|-----------:|
| Constructor (2 recipients) | ~600k |
| Constructor (8 recipients) | ~1.4M |
| `distribute()` 2 recipients | ~75k |
| `distribute()` 8 recipients | ~280k |

Locked via `forge snapshot` committed as `contracts/.gas-snapshot`. CI gate: `forge snapshot --check`
fails on >5% drift per test.

### 2.4 Foundry test plan

Files: `contracts/test/Splitter.t.sol`, `contracts/test/Splitter.fuzz.t.sol`,
`contracts/test/Splitter.invariant.t.sol`, `contracts/test/SplitterFork.t.sol`.

**Unit (§6.1):** 17 cases covering constructor (single/two/eight recipients + all four revert paths),
`distribute` (correct split, events, zero-amount no-op, anyone-can-call, sequential-clears-balance,
paymentId logged), `getRecipient` (valid + invalid slot).

**Fuzz (§6.2):** `testFuzz_distribute_anyValidBps(uint16[8] bps, uint256 amount)` — random BPS
(sum-constrained to 10_000, no zero addresses), `amount ∈ [0, uint96.max]`, pre-fund splitter, call
distribute, assert each recipient received `amount * bps[i] / 10000` and residual ≤
`totalRecipients`. 1000 runs.

**Invariants (§6.3):** (1) distribute never panics (handler fuzz); (2) balances sum to input (mint,
distribute handler); (3) immutable state holds (trivial, worth an assertion).

**Fork (§7.2):** `SplitterFork.t.sol` runs against Base Sepolia, uses real USDC, signs an
EIP-3009 authorization in-test via `vm.sign(pk, digest)`, calls `USDC.transferWithAuthorization`
(buyer → Splitter), then calls `Splitter.distribute`, asserts the full on-chain path end-to-end.
Invoked with `forge test --fork-url base_sepolia`.

**Differential (§6.5, recommended):** a minimal `SplitterReference.sol` oracle contract, differential
test asserts identical event sequences on matching inputs. Catches immutable-slot indexing bugs.

### 2.5 Deployment

Foundry script `contracts/script/DeploySplitter.s.sol` per `01_splitter.md` §7.1 reads env vars
`SPLITTER_TOKEN`, `SPLITTER_RECIPIENTS`, `SPLITTER_BPS`.

**Signing by KMS deployer EOA (`0x66c2858d9a8605957c516a77262eb66ee6be113c`):** `forge script` does
not natively sign via AWS KMS. L3 uses a small TS deploy wrapper
(`tools/deploy/deploy-splitter.ts`) that:

1. Reads the compiled Splitter bytecode + constructor args from `contracts/out/`.
2. Builds the contract-creation tx via viem.
3. Signs via AWS KMS (alias `alias/reckon402/mainnet/deployer/evm`) using the existing
   `tools/sign/kms-account.mjs` helper graduated to TS — or, if the TS wrapper is not ready at
   deploy time, the deploy runs under a plaintext export of the deployer PK for the single tx.
   The TS + KMS path is the documented option; the plaintext fallback is documented as a hard
   stop condition (operator confirms before proceeding).
4. Submits via `BASE_SEPOLIA_RPC_PRIMARY`, waits for receipt.
5. Writes `contracts/deploy-logs/splitter-base-sepolia-<date>.md` with address, tx hash,
   Basescan link, gas used, constructor args.

Deploy runs under `infisical run --env dev -- bash -c '...'` (single-quoted body — shell-expansion
gotcha from AGENTS.md).

**Deployment recipient set for L3 demo** (BPS sum = 10_000):

| Slot | Address | BPS | Role |
|------|---------|----:|------|
| 0 | `0xD53ffac42496d73B3Faf946786688a8454F57b1f` | 9700 | Seller (L2 seller EOA, continuity) |
| 1 | `0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455` | 200  | Facilitator fee (Facilitator EOA) |
| 2 | `0x66c2858d9a8605957c516a77262eb66ee6be113c` | 100  | Protocol treasury (Deployer EOA placeholder) |

Constructor emits `Deployed(token, totalRecipients, recipients, bps)` — the deploy log records this
event's block + tx for forward audit.

Basescan verification: `forge verify-contract` command form per `01_splitter.md` §7.4, captured in
`tools/deploy/deploy-splitter.md`.

---

## 3. Reckon402 Facilitator worker

Location: `workers/facilitator/`. Custom domain `facilitator.reckon402.com` (no `workers_dev`).
D1 binding `DB` → database `reckon402-d1-facilitator-dev`.

### 3.1 D1 schema (verbatim from `02_facilitator.md` §3)

Migration `migrations/0001_init.sql`, three tables:

**`receipts`** — primary ledger, PK `payment_id`. Columns (complete list):
`payment_id TEXT PK`, `request_id TEXT`, `state TEXT CHECK IN ('SUBMITTED','PENDING_CONFIRMATION',
'CONFIRMED','RECONCILED','FAILED')`, `network TEXT`, `version INTEGER CHECK (version=2)`,
`auth_from`, `auth_to`, `auth_value`, `auth_valid_after`, `auth_valid_before`, `auth_nonce`,
`transaction`, `submitted_at`, `block_number`, `block_timestamp`, `confirmed_at`, `gas_used`,
`retry_count` (default 0), `last_retry_at`, `reconcile_notes`, `failure_reason`, `failure_detail`,
`td_erc8004_tx`, `td_morpho_tx`, `td_shares`, `td_deposited_at`. Indexes: UNIQUE on
`payment_id`, plus non-unique on `transaction`, `request_id`, `state`, `auth_from`.

**`recipients`** — Splitter `Distributed` event lineage, PK `(payment_id, slot)`. Populated by the
reconciler / event observer when it observes `Distributed` events. Columns: `payment_id`, `slot`,
`address`, `bps`, `amount`, `distributed_at`, `distributed_tx`. FK to receipts with `ON DELETE
CASCADE`. Index on `address`.

**`attestations`** — schema-only at L3 (L4 populates on ERC-8004 write). Columns per §3.3.

The full CREATE TABLE statements land verbatim in `workers/facilitator/migrations/0001_init.sql`
— design doc §3 is the source of truth.

### 3.2 Minimum-viable X35 state machine

From design pack `02_facilitator.md` §6.1. L3 MUST-implement vs deferred:

| From | To | Trigger | L3 status |
|------|-----|---------|-----------|
| (none) | `SUBMITTED` | `POST /x402/verify` succeeds, INSERT OR IGNORE new row | **MUST** |
| `SUBMITTED` | `PENDING_CONFIRMATION` | `POST /x402/settle` submits tx | **MUST** |
| `SUBMITTED` | `FAILED` | tx submission rejected by RPC | **MUST** |
| `PENDING_CONFIRMATION` | `CONFIRMED` | receipt poll returns success | **MUST** |
| `PENDING_CONFIRMATION` | `FAILED` | tx reverted on-chain | **MUST** |
| `PENDING_CONFIRMATION` | `FAILED` | past `validBefore`, no receipt | **MUST** |
| `PENDING_CONFIRMATION` | `PENDING_CONFIRMATION` | `POST /x402/reconcile` indeterminate | stub-only |
| `CONFIRMED` | `RECONCILED` | Splitter `Distributed` event observed | **stub-only at L3** (L4) |

`RECONCILED` + `FAILED` are terminal. CHECKPOINT is not in the design pack table and is not
implemented. The state machine is codified in `workers/facilitator/src/state-machine.ts`; illegal
transitions throw.

### 3.3 HTTP API surface

All endpoints defined in `02_facilitator.md` §4 (already documented — L3 is the first implementation).
L3 response shapes preserve canonical x402-v2 field names at the top (`transaction`, `payer`,
`network`, `success`, `amount`) with Reckon402 X35 extensions below (`paymentId`, `requestId`,
`state`, `receipt`). Wire-compat invariants per §5 (additive superset) are enforced by the
`@reckon402/types` `FacilitatorSettleResponse` shape.

Endpoints implemented at L3:

- `POST /x402/verify` — validate EIP-3009, derive `paymentId`, INSERT OR IGNORE receipt as
  `SUBMITTED`, return the current receipt snapshot. Idempotent on `paymentId`. Behaviour per §4.1.
- `POST /x402/settle` — called by the middleware's `Facilitator.settle()` path. **The L3
  implementation folds `/verify` + `/settle` into a single logical call** for the middleware consumer:
  `@reckon402/facilitator-client`'s `Reckon402Facilitator.verify()` calls the worker's
  `/x402/verify`; `.settle()` calls the worker's `/x402/settle` which runs the design-pack §4.2
  `autoSettle: true` path (submit the two settlement txs, inline-poll to confirmation, return with
  `state: CONFIRMED`). This keeps the agent-side middleware unchanged from L2.
- `GET /x402/receipt/:paymentId` — D1 read by primary key. Returns the full Receipt snapshot.
- `GET /x402/receipt/by-tx/:transaction` — D1 read via `idx_receipts_transaction`.
- `GET /x402/receipt/by-request/:requestId` — D1 read via `idx_receipts_request_id`.
- `POST /x402/reconcile` — **stub at L3**: returns HTTP 200 body `{ deferred: true }`. The real
  sweep logic per §9 is post-hackathon polish; comment at the handler points at the spec section.
- `GET /healthz` — per §13. L3 probes: `d1_read`, `d1_write` (against `_healthz_probe` TTL table),
  `base_rpc_primary`, `base_rpc_fallback`, `splitter_contract` (`token()` read — the v1 Splitter
  exposes `token` not `version`; healthz reads whichever view function exists — `token()` is the
  cheapest). Aggregate status per §13.

All responses include header `X-Reckon402-Request-Id: <uuid>` for tracing (§4 preamble).

### 3.4 Settlement tx submission (two-transaction settle)

Critical architectural fact: an L3 settle is **two** on-chain transactions, both signed by the
facilitator EOA (`0x0A02...c455`, software custody, PK in Infisical as `FACILITATOR_PK`):

1. **USDC.transferWithAuthorization** — `auth.from = buyer`, `auth.to = SPLITTER_ADDRESS`,
   `value`, `validAfter`, `validBefore`, `nonce`, `(v, r, s)` split from the flat 65-byte signature.
   USDC transfers from buyer → Splitter.
2. **Splitter.distribute(paymentId, amount)** — Splitter distributes to the immutable recipient set
   per BPS; emits `Distributed(paymentId, slot, recipient, bps, amount)` for each non-zero share.

Tx construction in `workers/facilitator/src/settle.ts` uses viem:

```ts
// Tx 1: transferWithAuthorization
const txAuth = await walletClient.writeContract({
  address: USDC_ADDRESS,
  abi: USDC_ABI,
  functionName: 'transferWithAuthorization',
  args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter),
         BigInt(auth.validBefore), auth.nonce as Hex, v, r, s],
})
// Wait for receipt (Base ~2s/block; chain-aware poll per §8 profile)
const receipt1 = await publicClient.waitForTransactionReceipt({ hash: txAuth })
if (receipt1.status !== 'success') return FAILED('TX_REVERTED', ...)

// Tx 2: Splitter.distribute
const txDist = await walletClient.writeContract({
  address: SPLITTER_ADDRESS,
  abi: SPLITTER_ABI,
  functionName: 'distribute',
  args: [paymentId, BigInt(auth.value)],
})
const receipt2 = await publicClient.waitForTransactionReceipt({ hash: txDist })
// CONFIRMED only after BOTH receipts succeed
```

The receipt's `transaction` field holds the `transferWithAuthorization` tx hash (the canonical x402
settlement tx). The `distribute` tx hash is stored in `reconcile_notes` at L3 (no dedicated column;
promoted to its own column at L4 when reconciliation goes live).

**RPC strategy (§7.2):** Two-RPC fallback via `Promise.allSettled([primaryRpc.sendTransaction,
fallbackRpc.sendTransaction])`; take first hash. At L3, `BASE_SEPOLIA_RPC_PRIMARY` is the Alchemy
`reckon402` app endpoint; the fallback is the public Base Sepolia RPC
(`https://sepolia.base.org`) — documented as not-production-grade but sufficient for demo.

**Gas (§7.3):** no hard-coded limit; viem auto-estimation. Fallback `gas: 80000n` if estimation
fails on the USDC tx, `gas: 300000n` if it fails on `distribute()`.

### 3.5 Inline-poll vs background-poll

L3 uses **inline poll with `ctx.waitUntil`** per §8.1 — recommended for the hackathon. `POST /settle`
behaviour: submit tx 1, write `state=PENDING_CONFIRMATION` + `transaction`, `ctx.waitUntil(poll →
submit tx 2 → poll → update state)`. The HTTP response to the middleware's `Facilitator.settle()`
call does NOT return until both txs confirm (the middleware needs the final state). Chain-aware
timeout from §8: Base 1500ms initial, 2000ms interval, 60s max wait. If the Worker times out before
both txs confirm, the receipt stays `PENDING_CONFIRMATION`; the F2 reconciler (real sweep deferred
to post-hackathon; stub at L3 returns `{ deferred: true }`) would pick it up — for L3, a timed-out
settle surfaces as a 502 to the middleware which surfaces as HTTP 502 to the buyer.

### 3.6 Worker file layout

```
workers/facilitator/
├── wrangler.toml                     # custom_domain facilitator.reckon402.com, D1 binding DB
├── package.json                      # @reckon402/facilitator-worker, workspace:* deps
├── tsconfig.json                     # extends ../../tsconfig.base.json
├── migrations/
│   └── 0001_init.sql                 # verbatim from §3.1
└── src/
    ├── index.ts                      # Hono app, mounts /x402 sub-app + /healthz
    ├── env.ts                        # typed Env bindings (DB, FACILITATOR_PK, SPLITTER_ADDRESS, USDC_ADDRESS, RPC URLs)
    ├── verify.ts                     # POST /x402/verify
    ├── settle.ts                     # POST /x402/settle (includes tx construction + inline poll)
    ├── receipt.ts                    # GET /x402/receipt/* routes
    ├── reconcile.ts                  # POST /x402/reconcile stub
    ├── healthz.ts                    # GET /healthz
    ├── state-machine.ts              # transition table + guards; throws on illegal
    ├── receipt-builder.ts            # D1 row → Receipt JSON
    ├── eip3009.ts                    # signature verification + digest helpers
    └── abi/
        ├── usdc.ts                   # minimal transferWithAuthorization + AuthorizationUsed event
        └── splitter.ts               # distribute + Distributed event + token() view
```

### 3.7 Vitest unit tests

- `test/payment-id.test.ts` — determinism (same authorization → same paymentId ×1000); uses the
  shared helper imported from `@reckon402/buyer-sdk` (see §4.3).
- `test/d1-idempotency.test.ts` — concurrent verify calls against the same authorization produce
  one row; second call returns existing state. Uses miniflare-backed D1 or `wrangler dev --local`.
- `test/state-machine.test.ts` — every allowed transition succeeds; every illegal transition throws.
- `test/settle.test.ts` — tx construction against mocked viem client: correct USDC args, correct
  Splitter args, two-RPC fallback on primary failure, correct FAILED reason mapping.
- `test/healthz.test.ts` — aggregate status logic (ok / degraded / down) from probe results.

---

## 4. Three workspace packages

All three follow the same layout pattern as the existing `@reckon402/types` package:
`package.json` (name `@reckon402/<pkg>`, version `0.1.0`, `type: module`, `main/types` pointing at
`./src/index.ts`, `exports: { ".": "./src/index.ts" }`, `files: ["src"]`, `license: MIT`),
`tsconfig.json` (`"extends": "../../tsconfig.base.json"`), `src/index.ts` barrel, `README.md`
(~30 lines), and `test/*.test.ts` (vitest). Zero registry publish at L3 — all consumed via
`workspace:*`.

### 4.1 `@reckon402/facilitator-client`

Two impls of the `Facilitator` interface from `@reckon402/types`:

- **`CdpFacilitator`** (lifted from `workers/agent/src/cdp-facilitator.ts` verbatim). Wraps the
  x402.org public testnet facilitator. Preserved for continuity + fallback.
- **`Reckon402Facilitator`** (new HTTP client to `facilitator.reckon402.com/x402`). Pure `fetch`,
  no runtime dep on the worker internals. Translates the `Facilitator` interface to the design pack
  §4 HTTP API.

Barrel `src/index.ts` re-exports both. `package.json` deps: `@reckon402/types: workspace:*`.

Tests: `test/cdp.test.ts`, `test/reckon402.test.ts`. Each fetches via mocked `global.fetch` and
covers happy path + each error code mapped back to the `Facilitator` interface. Assertions include
`fetch` URL, method, body shape — not just the mapped return value. (Feedback memory: mock
enforcement interfaces must assert arguments.)

### 4.2 `@reckon402/middleware-hono`

One export: the `withX402(opts)` factory, lifted verbatim from
`workers/agent/src/x402-middleware.ts`. Public API unchanged. Uses `@reckon402/types` for all
shapes; imports `computePaymentId` from `@reckon402/buyer-sdk` (shared helper — see §4.3).

Tests: `test/withX402.test.ts` reuses the L2 lock-in pattern
`toHaveBeenCalledWith(_, EXPECTED_REQUIREMENTS)` against a mocked `Facilitator`. Verifies the
package-level middleware constructs identical `PaymentRequirements` as the L2 worker did. L2's own
middleware test at `workers/agent/test/x402-middleware.test.ts` MUST continue to pass after the
agent worker is swapped to consume this package — that test is the regression gate.

Package deps: `@reckon402/types: workspace:*`, `@reckon402/buyer-sdk: workspace:*`, `hono`.

### 4.3 `@reckon402/buyer-sdk`

Four exports (barrel `src/index.ts`):

- `signPayment(opts: { privateKey, buyer, seller, amount, network, usdc, validSeconds })` —
  returns `{ payload: PaymentPayload, paymentId: Hex }`. Signs EIP-3009 TransferWithAuthorization via
  viem's `signTypedData` (EIP-712 domain: `{ name: 'USDC', version: '2', chainId, verifyingContract:
  usdc }`). Random 32-byte nonce. Graduated from `tools/integration-tests/buyer-sign.mjs`.
- `encodeXPaymentHeader(payload: PaymentPayload): string` — `btoa(JSON.stringify(payload))`.
- `decodeXPaymentResponse(headerValue: string): SettlementResponse` — base64-JSON-parse.
- `computePaymentId(auth: EIP3009Authorization): Hex` — **the canonical shared helper**. Formula
  matches L2's `workers/agent/src/payment-id.ts` byte-for-byte:

  ```ts
  keccak256(encodePacked(
    ['address','address','uint256','uint256','uint256','bytes32'],
    [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter),
     BigInt(auth.validBefore), auth.nonce as Hex],
  ))
  ```

  **Both the buyer-sdk and the facilitator worker import this function from
  `@reckon402/buyer-sdk`.** This eliminates any possibility of divergence — the function is the
  single source of truth, not two copies with a byte-equality cross-impl test. The L2 worker's
  `workers/agent/src/payment-id.ts` is deleted at L3 and replaced with an import from the package.

Package deps: `@reckon402/types: workspace:*`, `viem`.

Tests: `test/sign.test.ts` (roundtrip sign → encode → decode against a fixed PK + fixture),
`test/payment-id.test.ts` (1000 random auths, same input → same output). No byte-equality
cross-impl test is needed — the function is shared, not duplicated.

---

## 5. agent.reckon402.com swap

Files modified under `workers/agent/`:

- **`wrangler.toml`** — add env vars:
  - `FACILITATOR_URL = "https://facilitator.reckon402.com/x402"` (was implicit CDP URL in code).
  - `SPLITTER_ADDRESS = "<deployed address from commit 6>"` — the recipient in the new
    `PaymentRequirements.payTo` (NOT the seller EOA anymore — see §5.1).
  - `NETWORK = "eip155:84532"`, `USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"`,
    `AMOUNT = "10000"` — promoted from hardcoded constants to env vars per L2 spec §5.5 note.

- **`src/index.ts`** — two changes:
  1. `import { CdpFacilitator } from './cdp-facilitator.js'` → `import { Reckon402Facilitator }
     from '@reckon402/facilitator-client'`.
  2. `new CdpFacilitator()` → `new Reckon402Facilitator(env.FACILITATOR_URL)`.
  3. `withX402({ ..., recipient: SELLER_ADDRESS, ... })` → `withX402({ ..., recipient:
     env.SPLITTER_ADDRESS, ... })`.

  The `withX402` import swaps from `'./x402-middleware.js'` to `'@reckon402/middleware-hono'`. The
  local `x402-middleware.ts`, `cdp-facilitator.ts`, and `payment-id.ts` files are deleted (their
  content lives in the workspace packages now).

- **`package.json`** — add `@reckon402/{facilitator-client,middleware-hono,buyer-sdk}@workspace:*`
  to dependencies. `viem` stays for the Hono runtime. `hono` stays.

- **`test/x402-middleware.test.ts`** — DELETED (moved to `packages/middleware-hono/test/`). The
  test body is preserved byte-for-byte — the lock-in pattern must continue to pass from the new
  location.

- **`test/cdp-facilitator.test.ts`** — DELETED (moved to `packages/facilitator-client/test/cdp.test.ts`).

- **`test/index.ts.test.ts`** — the agent-level integration test (if present) is updated to mock
  `Reckon402Facilitator` instead of `CdpFacilitator`. It asserts the swap is wire-compatible: the
  middleware constructs the same `PaymentRequirements` (now with `payTo = SPLITTER_ADDRESS` instead
  of `SELLER_ADDRESS`) and the facilitator receives identical arguments.

### 5.1 Q-04-α: `auth.to = Splitter`, not seller — this is a behaviour change

Design pack `02_facilitator.md` §4.1 request body: `authorization.to MUST equal x402.splitter ENS
record for merchant`. The Splitter HOLDS the USDC after `transferWithAuthorization`; `distribute()`
is a separate second tx that forwards to recipients.

L2 shipped with `auth.to = seller EOA` (direct single-recipient transfer, no Splitter). L3 flips
this: `auth.to = Splitter address`. This changes the EIP-712 domain message the buyer signs — it's
NOT a pure config swap from the agent worker's perspective; it changes the `PaymentRequirements.payTo`
the buyer sees in the 402 response, which changes the signed authorization.

The L2 middleware test asserts `EXPECTED_REQUIREMENTS.payTo === SELLER`. When the agent worker is
swapped to `payTo = SPLITTER`, the lifted test in `packages/middleware-hono/test/withX402.test.ts`
MUST be updated accordingly — the lock-in pattern is preserved (assert exact requirements), but
the expected value changes. **This is NOT a regression** — it's the intended L3 architecture flipping
`auth.to` from seller EOA to Splitter. The AGENTS.md-level regression guard is: L2's assertion
*pattern* (`toHaveBeenCalledWith(_, EXPECTED_REQUIREMENTS)`) must survive into the packaged tests;
the *values* inside `EXPECTED_REQUIREMENTS` necessarily change at L3. Flagged here so Commit 4/5
review catches it deliberately.

---

## 6. Test plan summary

Full detail in the respective `contracts/test/`, `workers/facilitator/test/`,
`packages/*/test/`, and `tools/integration-tests/` directories.

| Layer | Mechanism | File | Notes |
|-------|-----------|------|-------|
| Foundry unit | `forge test` | `contracts/test/Splitter.t.sol` | 17 cases per §2.4 |
| Foundry fuzz | `forge test --fuzz-runs 1000` | `contracts/test/Splitter.fuzz.t.sol` | BPS invariant |
| Foundry invariant | `forge test` | `contracts/test/Splitter.invariant.t.sol` | 3 invariants |
| Foundry fork | `forge test --fork-url base_sepolia` | `contracts/test/SplitterFork.t.sol` | real USDC |
| Vitest (facilitator) | `pnpm -F @reckon402/facilitator-worker test` | `workers/facilitator/test/*.test.ts` | §3.7 |
| Vitest (facilitator-client) | `pnpm -F @reckon402/facilitator-client test` | `packages/facilitator-client/test/*.test.ts` | fetch-mock |
| Vitest (middleware-hono) | `pnpm -F @reckon402/middleware-hono test` | `packages/middleware-hono/test/withX402.test.ts` | EXPECTED_REQUIREMENTS lock-in |
| Vitest (buyer-sdk) | `pnpm -F @reckon402/buyer-sdk test` | `packages/buyer-sdk/test/*.test.ts` | roundtrip + paymentId determinism |
| Integration (full flow) | bash + buyer-sdk + curl | `tools/integration-tests/full-flow-l3.sh` | one round-trip, on-chain settled, receipt CONFIRMED |
| Integration (replay) | bash + curl + receipt compare | `tools/integration-tests/replay-l3.sh` | same paymentId twice, second short-circuits from D1 |
| Observability | `wrangler tail` captures | run log | 4 round-trips recorded |

No cross-impl byte-equality test for `paymentId` — the function is shared via `@reckon402/buyer-sdk`,
not duplicated. The determinism test in the package already proves stability.

---

## 7. L3 deployments (to record in AGENTS.md at commit 6)

A new `## L3 deployments (v1, locked)` section is appended to `AGENTS.md` in commit 6 with:

| Item | Value |
|------|-------|
| Splitter contract (Base Sepolia) | `0x...` (from deploy log) |
| Splitter deploy tx | `0x...` |
| Deploy signer | `0x66c2858d9a8605957c516a77262eb66ee6be113c` (KMS deployer) |
| Basescan link | `https://sepolia.basescan.org/address/0x...` |
| D1 database name | `reckon402-d1-facilitator-dev` |
| D1 database ID | `<uuid from wrangler d1 create>` |
| Facilitator worker URL | `https://facilitator.reckon402.com` |
| Agent worker URL | `https://agent.reckon402.com` (unchanged from L1/L2) |

---

## 8. Definition of done

- [ ] Six commits land on `main` per H.4 cadence.
- [ ] `L3-our-facilitator-green` annotated tag created and pushed.
- [ ] Splitter deployed on Base Sepolia; address recorded in AGENTS.md `## L3 deployments`.
- [ ] D1 database `reckon402-d1-facilitator-dev` exists; `wrangler d1 execute --command "SELECT
      name FROM sqlite_master WHERE type='table'"` returns `receipts`, `recipients`, `attestations`,
      `_healthz_probe` (+ `_cf_*` system tables).
- [ ] `https://facilitator.reckon402.com/healthz` returns 200 with the §13 body shape.
- [ ] `https://agent.reckon402.com/research?q=test` returns 402 with a `PAYMENT-REQUIRED` header
      whose `accepts[0].payTo === SPLITTER_ADDRESS` (NOT the seller EOA).
- [ ] `tools/integration-tests/full-flow-l3.sh` exits 0; on-chain settlement tx visible on Basescan;
      `Splitter.Distributed` events visible for each non-zero BPS slot.
- [ ] `tools/integration-tests/replay-l3.sh` exits 0; second call returns the same paymentId and
      the same tx hash; no new on-chain tx submitted.
- [ ] `forge test` all green (unit + fuzz + invariants + fork).
- [ ] `pnpm -r test` all green (all vitest suites across packages + workers).
- [ ] L2's middleware test lock-in pattern survives into `packages/middleware-hono/test/` (with
      Q-04-α-flagged value update for `payTo`).
- [ ] `wrangler tail` captured for both flows: initial verify, initial settle, replay verify,
      replay settle-short-circuit-from-D1. Log excerpts committed under `tools/integration-tests/`.
- [ ] Final tool message reports commit SHAs, addresses, URLs, curl outputs, Basescan links, tail
      excerpts.

---

## 9. Open questions

**Q-04-α — CLARIFIED** (see §5.1): at L3, `auth.to` flips from seller EOA (L2) to Splitter address.
This is the documented L3 architecture per design pack §4.1 but is a behaviour change, not a config
swap, from the buyer's perspective. The L2 middleware-test `EXPECTED_REQUIREMENTS` lock-in pattern
is preserved; only the `payTo` value inside it changes. No regression.

**Q-04-β** — OPEN: the design pack `02_facilitator.md` §10.1 shows a `Distributed` event signature
with a `uint256 timestamp` arg; `01_splitter.md` §2 shows the same event WITHOUT `timestamp` (five
args total). `01_splitter.md` is canonical (§11 cross-ref confirms); the §10.1 shape is a doc
drift. L3 implements the `01_splitter.md` shape (no timestamp). Filed for research-repo
maintainer to correct in the design pack.

**Q-04-γ** — OPEN: the KMS deployer signer for Splitter deployment. The chosen path is a small
TS viem + KMS wrapper (`tools/deploy/deploy-splitter.ts`). If that wrapper is not ready at commit 6
deploy time, the fallback is a one-off plaintext export of the deployer PK *from KMS* for the
single deploy tx (which violates the "non-retrievable by design" KMS property). The wrapper path is
preferred; the fallback is a hard-stop requiring operator confirmation. Resolution: commit 6
operator runbook makes the choice explicit and logs it.

**Q-04-δ** — DEFERRED to L4: real reconciler sweep (design pack §9). L3 ships `/x402/reconcile` as
a stub returning `{ deferred: true }`. L4 lands the cron sweep.

**Q-04-ε** — DEFERRED: ERC-8004 attestation INSERT path (§10.2). Schema is present at L3; INSERT
logic is H-7 polish or L4.
