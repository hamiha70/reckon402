# Spec 07 — L4b₁: ERC-8004 settlement-attestation writes (DXb rail)

Status: implementation contract.

Sources: `AGENTS.md` (locks table, EOA topology, L4a2 deployed state),
`specs/06-actor-act-matrix.md` (D1–D14 locks; decisions referenced by
number below), `specs/04-l3-our-facilitator.md` (Q-04-ε resolved by
this spec), `specs/04-l4a-gateway.md` (cache-invalidate hook shape
and reputation read path that this spec closes the loop on),
`packages/erc-8004-client/src/reputation.ts` (the `giveFeedback`
call site).

---

## 1. Purpose and scope

L4b₁ lands the first on-chain writes to ERC-8004's
`ReputationRegistry` from the Reckon402 facilitator. Every confirmed
x402 settlement produces one `giveFeedback` tx tagged
`("payment", "x402-settlement")`, recorded in D1, and followed by a
gateway cache-invalidate POST so the next resolution reflects the new
count. This is the load-bearing "agent commerce with memory" pitch
surface.

**What L4b₁ ships:**

- **Inline attestation hook** in `workers/facilitator/src/settle-route.ts`
  via `c.executionCtx.waitUntil(maybeWriteAttestation(...))` at the
  end of the CONFIRMED transition success path. No cron watcher, no
  external event observation — the facilitator is the actor that
  submits `Splitter.distribute()`, so it already holds the settlement
  signal in-process when CONFIRMED is written. Supersedes the
  design-pack `02_facilitator.md` §10.1 Option A cron watcher.
- **`workers/facilitator/src/treasury/` package** — three files:
  `attestation.ts` (maybeWriteAttestation + guards),
  `cache-invalidate.ts` (gateway hook caller), and `agent-resolver.ts`
  (demo-scoped wallet → agentId lookup).
- **D1 migration 0002** adding `failure_detail` column to the existing
  `attestations` table (for diagnostics on failed writes). The
  `attestations` table itself and `receipts.td_erc8004_tx` column
  already ship with the L3 `0001_init.sql`.
- **Env-var feature flag `ENABLE_ERC8004_WRITES`** (pattern mirrors
  L4a2's `ENABLE_ERC8004_READS`). Default `"false"` in `wrangler.toml`
  until staging smoke passes; then flipped to `"true"` in the deploy
  commit.
- **Unit tests** in `workers/facilitator/test/attestation.test.ts`
  asserting every guard condition plus the happy path's exact args
  passed to `reputation.giveFeedback`.
- **`AGENTS.md ## L4b1 ERC-8004 attestation writes` section** with
  deployment IDs, tx hashes, and test counts.

**What L4b₁ does NOT ship:**

- No Lambda signing wrapper (L4b₂).
- No KH skill / workflow JSON / recipes (L4b₂).
- No buyer-side DXa attestation path (D13: permanently not shipped).
- No ValidationRegistry writes (D14: upstream-blocked).
- No ERC-8004 IdentityRegistry registration (D9 Path A: seller
  pre-registers once, out of hot path).
- No per-merchant ENS-driven opt-in lookup. The hackathon uses a
  boolean env var; per-merchant opt-in via `x402.attestation = "on"`
  ENS text record is a v1.5 evolution, flagged below.
- No batching. Per-settlement writes at ~$0.0002/write on Base are
  economic (D11).

---

## 2. Actors and acts (matrix cross-reference)

Per `specs/06-actor-act-matrix.md` §4:

| Act | Actor | Key source | Gas source |
|-----|-------|-----------|-----------|
| A4. Sign + broadcast `ReputationRegistry.giveFeedback` | Facilitator | `FACILITATOR_PK` (Wrangler secret, software custody) | Facilitator fee slot in EIP-3009 Splitter BPS |
| A5. Invalidate gateway cache | Facilitator (caller) | `GATEWAY_CACHE_HOOK_TOKEN` bearer (Wrangler secret) | n/a (HTTP POST) |

**Not-signer-on-giveFeedback:** buyer key is NOT used (D3 correction
— the facilitator writes DXb settlement-observation attestations,
not buyer DXa satisfaction reviews).

**ClientAddress recorded on-chain:** the facilitator EOA
`0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455`. This is intentional
and semantic: the facilitator is attesting that it observed
settlement for this agent at this price. Downstream consumers
(Tradewise-style indexers) can distinguish DXb from DXa by tag.

---

## 3. D1 schema delta

### 3.1 Migration 0002

```sql
-- workers/facilitator/migrations/0002_l4b_writes.sql
-- L4b₁ adds a diagnostics column for failed attestation writes.
-- The attestations table + receipts.td_erc8004_tx column already ship
-- with 0001_init.sql (schema-only at L3).

ALTER TABLE attestations ADD COLUMN failure_detail TEXT;
```

No index change. No new table. The migration is intentionally
minimal.

### 3.2 Row shapes

**Happy path** (attestation confirmed on-chain):

| Column | Value |
|--------|-------|
| payment_id | `0x<64-hex>` (matches `receipts.payment_id`) |
| agent_id | `1` (SELLER_AGENT_ID for demo) |
| reputation_tx | `0x<64-hex>` tx hash |
| written_at | `Date.now()` ms |
| feedback_tag1 | `"payment"` |
| feedback_tag2 | `"x402-settlement"` |
| feedback_value | `1` |
| feedback_decimals | `0` |
| failure_detail | `NULL` |

Simultaneously, `receipts.td_erc8004_tx` is updated to the same tx
hash so the receipt snapshot can surface the attestation without a
join.

**Failure path** (revert, RPC outage, guard hit mid-write):

| Column | Value |
|--------|-------|
| reputation_tx | `"FAILED"` (sentinel) |
| failure_detail | free-form, truncated to 500 chars |
| everything else | same as happy path |

`receipts.td_erc8004_tx` stays `NULL` on failure — the receipt's
canonical x402-v2 shape is unaffected. Payment state remains
`CONFIRMED`; the failure does not propagate.

**Idempotency:** the `attestations` PK is `(payment_id, agent_id)`.
A second attempt against the same paymentId is a no-op.

---

## 4. Env variables

### 4.1 New variables (wrangler.toml `[vars]`)

| Var | Default | Purpose |
|-----|---------|---------|
| `ENABLE_ERC8004_WRITES` | `"false"` | Master switch. Staging ships `"false"` until smoke passes; production flip is a deploy commit. |
| `ERC8004_CHAIN_ID` | `"84532"` | Pinned Base Sepolia chainId for the demo. L4c (mainnet) revisits. |
| `SELLER_AGENT_ID` | `"1"` | Demo-scoped pinned agentId. Matches `gateway/migrations/seed_l4a2.sql` mapping for `seller.reckon402-test.eth`. **Hackathon constraint** — multi-seller resolution is v1.5 via ENS `x402.agent_id` text record. |
| `GATEWAY_CACHE_HOOK_URL` | `"https://gateway.reckon402.com/hooks/cache-invalidate"` | L4a2 gateway's cache-invalidate endpoint. |
| `ATTESTATION_FEEDBACK_URI_PREFIX` | `"https://facilitator.reckon402.com/x402/receipt/"` | Produces `feedbackURI` per ERC-8004 arg: `<prefix><paymentId>`. |

### 4.2 New secrets (wrangler secret put)

| Secret | Purpose |
|--------|---------|
| `GATEWAY_CACHE_HOOK_TOKEN` | Bearer token for the cache-invalidate POST. Same value that the L4a2 gateway holds as its `GATEWAY_CACHE_HOOK_TOKEN` secret — the two must match. |
| `BASE_SEPOLIA_RPC_PRIMARY` | Already present for L3; the attestation write reuses it. No new value. |

**Why not use the existing facilitator `BASE_SEPOLIA_RPC_PRIMARY` for
the attestation?** We do. No separate RPC binding.

---

## 5. `maybeWriteAttestation` contract

Located at `workers/facilitator/src/treasury/attestation.ts`.

### 5.1 Signature

```ts
export interface AttestationEnv {
  DB: D1Database
  FACILITATOR_PK: string
  BASE_SEPOLIA_RPC_PRIMARY: string
  ENABLE_ERC8004_WRITES: string
  ERC8004_CHAIN_ID: string
  SELLER_AGENT_ID: string
  GATEWAY_CACHE_HOOK_URL: string
  GATEWAY_CACHE_HOOK_TOKEN?: string
  ATTESTATION_FEEDBACK_URI_PREFIX: string
}

export interface AttestationInput {
  paymentId: `0x${string}`
  transferTx: `0x${string}`
  distributeTx: `0x${string}`
  authValue: string    // atomic-units string from receipts.auth_value
}

export async function maybeWriteAttestation(
  env: AttestationEnv,
  input: AttestationInput,
): Promise<void>
```

### 5.2 Guard order

The function is fire-and-forget by design — callers wrap it in
`ctx.waitUntil(maybeWriteAttestation(...).catch(logErr))`. Internal
errors are logged; no rethrow.

Guards (in order, fail-fast return):

1. **`ENABLE_ERC8004_WRITES !== "true"`** → return. Keeps the code
   path cold in dev/staging until the flag flips. Matches L4a2
   reads-flag discipline.
2. **`SELLER_AGENT_ID` parse fails** → log `CONFIG_ERROR`, return.
3. **`ERC8004_CHAIN_ID` parse fails or unsupported** → log
   `CONFIG_ERROR`, return.
4. **Idempotency:** `SELECT 1 FROM attestations WHERE payment_id = ?1
   AND agent_id = ?2` returns a row → return. No write.
5. **Happy path:**
   - Compute `feedbackURI = ATTESTATION_FEEDBACK_URI_PREFIX + paymentId`.
   - Compute `feedbackHash = keccak256(toHex(JSON.stringify({
     paymentId, transferTx, distributeTx, authValue })))`.
   - Call `reputation.giveFeedback` via the library, with the
     facilitator `walletClient` (same viem client pattern used by
     `settle.ts`).
   - On success: two SQL writes in sequence — `INSERT OR IGNORE INTO
     attestations` + `UPDATE receipts SET td_erc8004_tx = ?`. Wait
     for the receipt (success-only) before the SQL.
   - On revert / RPC error: log, `INSERT OR IGNORE INTO attestations
     (reputation_tx='FAILED', failure_detail=<trimmed>)`. Do not
     update `receipts.td_erc8004_tx`.
6. **Cache-invalidate:** after a successful write only, fire-and-forget
   POST to `GATEWAY_CACHE_HOOK_URL`. Errors logged, not propagated.

### 5.3 Exact `giveFeedback` args

Matches `packages/erc-8004-client/src/reputation.ts:281` upstream
commit `0463311`:

| Arg | Value |
|-----|-------|
| `chainId` | `Number(env.ERC8004_CHAIN_ID)` |
| `walletClient` | viem wallet client backed by `FACILITATOR_PK` |
| `agentId` | `BigInt(env.SELLER_AGENT_ID)` |
| `value` | `1n` |
| `valueDecimals` | `0` |
| `tag1` | `"payment"` |
| `tag2` | `"x402-settlement"` |
| `endpoint` | `"https://facilitator.reckon402.com/x402/settle"` |
| `feedbackURI` | `<prefix><paymentId>` |
| `feedbackHash` | keccak256 of canonical JSON per §5.2 |

### 5.4 Gateway cache-invalidate body

POST to `GATEWAY_CACHE_HOOK_URL` with:

```json
{
  "chainId": 84532,
  "agentId": "1",
  "keys": ["reputation.getClients", "reputation.getSummary"]
}
```

Headers: `Authorization: Bearer <token>`, `Content-Type:
application/json`. The two keys invalidate the L4a2 read path's
`getSummaryForAllClients` two-step (`getClients` + `getSummary`).
Over-invalidation is acceptable; no finer-grained invalidation is
provided by the L4a2 gateway.

---

## 6. Wiring into `settle-route.ts`

Location of the hook: the success path of the CONFIRMED transition
(`settle-route.ts:159-181` in the current file). After the `UPDATE
receipts SET state = 'CONFIRMED'` runs, schedule the attestation via
`c.executionCtx.waitUntil(...)`. The HTTP response still returns
synchronously on the canonical settle outcome; the attestation runs
in Workers' background-task budget.

```ts
// at end of success branch, after UPDATE CONFIRMED:
c.executionCtx.waitUntil(
  maybeWriteAttestation(
    {
      DB: c.env.DB,
      FACILITATOR_PK: c.env.FACILITATOR_PK,
      BASE_SEPOLIA_RPC_PRIMARY: c.env.BASE_SEPOLIA_RPC_PRIMARY,
      ENABLE_ERC8004_WRITES: c.env.ENABLE_ERC8004_WRITES,
      ERC8004_CHAIN_ID: c.env.ERC8004_CHAIN_ID,
      SELLER_AGENT_ID: c.env.SELLER_AGENT_ID,
      GATEWAY_CACHE_HOOK_URL: c.env.GATEWAY_CACHE_HOOK_URL,
      GATEWAY_CACHE_HOOK_TOKEN: c.env.GATEWAY_CACHE_HOOK_TOKEN,
      ATTESTATION_FEEDBACK_URI_PREFIX: c.env.ATTESTATION_FEEDBACK_URI_PREFIX,
    },
    {
      paymentId,
      transferTx: outcome.transferTx,
      distributeTx: outcome.distributeTx,
      authValue: auth.value,
    },
  ).catch((err) => console.error('maybeWriteAttestation_unhandled', err)),
)
```

The `.catch` is defense-in-depth: `maybeWriteAttestation` handles
its own errors internally, but `ctx.waitUntil` unhandled-rejection
semantics make the outer guard cheap.

---

## 7. Test plan

### 7.1 Unit tests — `workers/facilitator/test/attestation.test.ts`

A fake D1 + spied `reputation.giveFeedback` + mocked `fetch` for
cache-invalidate covers every guard:

| # | Case | Asserts |
|---|------|---------|
| 1 | `ENABLE_ERC8004_WRITES = "false"` | No D1 query; no giveFeedback call; no fetch |
| 2 | Malformed `SELLER_AGENT_ID` | No giveFeedback call; error logged (captured via `vi.spyOn(console, 'error')`) |
| 3 | Idempotency — row already exists | No giveFeedback call; no fetch |
| 4 | Happy path | giveFeedback called with EXACT args per §5.3; INSERT INTO attestations with correct columns; UPDATE receipts SET td_erc8004_tx; fetch called with correct body + bearer |
| 5 | giveFeedback throws (revert / RPC) | INSERT INTO attestations with `reputation_tx='FAILED'` and `failure_detail` populated; NO UPDATE to receipts; NO fetch to cache-invalidate |
| 6 | Cache-invalidate fetch fails | attestation row still written; error logged; function resolves (does not throw) |
| 7 | Missing `GATEWAY_CACHE_HOOK_TOKEN` | Skip cache-invalidate silently; attestation row still written |

Mocks: the viem `walletClient.writeContract` is mocked at the module
level (same pattern as `workers/facilitator/test/settle.test.ts`
mocks `viem`). `fetch` is stubbed via `globalThis.fetch = vi.fn()`.

**Argument-assertion discipline** (per the feedback-memory lesson):
every mock call MUST be asserted on its full args, not just call
count. This catches renames, encoding shifts, and parameter-order
bugs at unit-test time.

### 7.2 Regression guard on `settle-route.test.ts`

The existing settle-route tests should continue to pass unchanged —
the attestation hook is wrapped in `ctx.waitUntil` and is a
fire-and-forget side effect on the CONFIRMED path. We add a single
new assertion to the happy-path test: **`c.executionCtx.waitUntil`
was called exactly once after the CONFIRMED UPDATE succeeded.**
This asserts the hook is wired, without testing the hook's internal
behaviour (which lives in attestation.test.ts).

Hono's `c.executionCtx` is Cloudflare's `ExecutionContext`. In
Miniflare-backed tests it's available; in our unit tests we pass a
stub via the second arg to `app.fetch(req, env, ctx)`.

### 7.3 Live integration smoke

`tools/integration-tests/fullflow-l3.sh` already drives a real
settlement. Extension: after success, the script reads the gateway
before+after to confirm the reputation count incremented:

```bash
# Before settlement
BEFORE_COUNT=$(curl -s "$GATEWAY/lookup/seller.reckon402-test.eth/x402.amount?backend=erc8004" | jq -r .value)
# ... run fullflow-l3 ...
# After settlement + attestation + cache-invalidate
sleep 8   # attestation tx + cache-invalidate propagation
AFTER_COUNT=$(curl -s "$GATEWAY/lookup/seller.reckon402-test.eth/x402.amount?backend=erc8004" | jq -r .value)
# Expect: AFTER_COUNT < BEFORE_COUNT (discount tier kicked in on count=1)
```

**Success criterion:** the `giveFeedback` tx is visible on Basescan;
`receipts.td_erc8004_tx` is populated in D1; the gateway's next
`x402.amount` read reflects a non-zero count (tier pricing engaged).

---

## 8. Deployment checklist

1. Apply `0002_l4b_writes.sql` to the D1 DB (`reckon402-d1-facilitator-dev`).
2. `wrangler secret put GATEWAY_CACHE_HOOK_TOKEN` (value matches what
   the L4a2 gateway holds; same secret used both sides).
3. Update `wrangler.toml` `[vars]` with the five new env vars (ship
   with `ENABLE_ERC8004_WRITES = "false"` initially).
4. `infisical run --env dev --domain https://secrets.intentralabs.com
   -- bash -c 'wrangler deploy --env staging'` (add staging env to
   `wrangler.toml` per the L4a2 pattern).
5. Smoke: run `fullflow-l3` against staging, verify no behaviour
   change (flag off).
6. Flip `ENABLE_ERC8004_WRITES = "true"` in `wrangler.toml`; redeploy.
7. Smoke: run the extended fullflow with the before/after count
   check. Capture Basescan tx URL and D1 row into a run-log.
8. Push `L4b1-erc8004-writes-green` annotated tag.

---

## 9. Open questions

**Q-07-1 — Multi-seller resolution.** The hackathon pins
`SELLER_AGENT_ID` per deployment. Production needs a per-payment
seller → agentId lookup. The cleanest path is ENS
`x402.agent_id` text record on the merchant's name, read via the
existing gateway. Deferred to v1.5.

**Q-07-2 — Opt-in signal.** The hackathon uses a single boolean
env flag (`ENABLE_ERC8004_WRITES`). Production should read
`x402.attestation = "on"` per merchant via the gateway, matching the
design-pack §10.2 intent. Deferred to v1.5.

**Q-07-3 — `feedbackHash` canonicalization.** The JSON stringify is
field-order-stable by virtue of object-literal order in the caller,
but this is brittle. A follow-up commit can swap to a deterministic
canonicalization (alphabetical key order, BigInt-safe). Deferred
post-hackathon.

**Q-07-4 — RECONCILED transition.** L3 currently transitions to
`CONFIRMED` only (`RECONCILED` is stub-only). The spec here fires
the attestation on `CONFIRMED`. When the real reconciler lands
post-hackathon, the hook may move to the `RECONCILED` transition
instead — L4b₁ schedules attestations on the earlier state, which is
correct because the facilitator submits both `transferWithAuthorization`
and `distribute()` synchronously before setting CONFIRMED.

**Q-07-5 — Failure retry.** The hackathon logs failures but does not
retry them. A cron-based retry reconciler (`WRITES_RETRY_CRON_ENABLED`
flag, sweep `state='CONFIRMED' AND td_erc8004_tx IS NULL AND
confirmed_at > now-1h`) is the v1.5 path. Deferred.

---

## 10. Definition of done

- [ ] `specs/07-l4b-erc8004-writes.md` lands (this file).
- [ ] `workers/facilitator/migrations/0002_l4b_writes.sql` added and
      applied to local + staging D1.
- [ ] `workers/facilitator/src/treasury/attestation.ts` implemented
      per §5.
- [ ] `workers/facilitator/src/treasury/cache-invalidate.ts`
      implemented per §5.4.
- [ ] `workers/facilitator/src/env.ts` extended with the new env
      vars.
- [ ] `workers/facilitator/wrangler.toml` updated with the `[vars]`
      block.
- [ ] `workers/facilitator/src/settle-route.ts` wires the
      `ctx.waitUntil(maybeWriteAttestation(...))` hook on CONFIRMED
      success.
- [ ] `workers/facilitator/test/attestation.test.ts` covers every
      guard per §7.1; all asserts argument shapes.
- [ ] Fresh-clone `pnpm test` count updated in AGENTS.md §L4b1.
- [ ] Staging smoke + before/after count check captured.
- [ ] `AGENTS.md ## L4b1 ERC-8004 attestation writes` section
      appended.
- [ ] Annotated tag `L4b1-erc8004-writes-green` pushed.

---

## 11. References

- `specs/06-actor-act-matrix.md` — D1–D14 locks; §4 gas model; §5
  summary matrix.
- `specs/04-l3-our-facilitator.md` — resolves Q-04-ε (ERC-8004
  INSERT path deferred from L3).
- `specs/04-l4a-gateway.md` — §17 cache-invalidate hook on the
  gateway side (contract this spec calls).
- `packages/erc-8004-client/src/reputation.ts:281` — the
  `giveFeedback` write surface this spec invokes.
- `workers/facilitator/src/settle-route.ts` — the site of the
  `ctx.waitUntil` hook.
- `gateway/src/routes/hooks/cache-invalidate.ts` — the receive side
  of the cache-invalidate POST.
