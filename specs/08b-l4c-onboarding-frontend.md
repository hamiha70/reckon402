# Spec 08B — L4c: Onboarding script + signed-writes gateway + frontend

Status: implementation contract. Handoff-ready for a fresh execution agent.

Sources:
- `specs/06-actor-act-matrix.md` — D1–D14 locks; §4 act decomposition.
- `specs/07-l4b-erc8004-writes.md` — L4b₁ state, attestation contract.
- `specs/08a-l4c-factory-refactor.md` — factory + per-payment splitter
  resolution (this spec CONSUMES 08A's factory).
- Memory: `terminology.md` (SellingAgent / BuyingAgent / agentId; ENS
  subname convention `seller{N}.reckon402-test.eth`),
  `l4c_scope_timeline.md` (30h budget; this spec = 20h of 30h),
  `ens_record_ownership_split.md` (Option 2b signed writes; per-key ACL),
  `ensip25_erc8004.md` (CAIP-2 pointer pair), `demo_narrative.md`
  (one-SellingAgent + Option C terminal pane), `post_hackathon_delivery_proof.md`
  (zkTLS and reverse-proxy off the table publicly).

Companion: Spec 08A ships the SplitterFactory + facilitator refactor. This
spec assumes 08A's factory is deployed; integration tested together.

---

## 1. Purpose and scope

Ship the onboarding primitive + merchant-sovereign record-writes +
demo-day frontend that make the "neutral router for agent commerce" pitch
concrete. One `just onboard seller{N}.reckon402-test.eth` command brings a
SellingAgent from zero to fully-wired. A simple HTML frontend triggers the
same flow via a button; a dashboard reads back live state from gateway +
Basescan + the facilitator receipts API.

This is the visible surface of L4c. Spec 08A gave us the neutral router;
Spec 08B is the onboarding and demo stagecraft.

**What Spec 08B ships:**

- `tools/onboard/` directory:
  - `onboard.ts` — Node CLI entrypoint that runs all 5 onboarding steps.
  - `steps/mint-subname.ts` — ENS subname mint (`setSubnodeOwner`).
  - `steps/deploy-splitter.ts` — calls Spec 08A's `SplitterFactory.createSplitter`.
  - `steps/register-agent-id.ts` — ERC-8004 `IdentityRegistry.registerAgent`.
  - `steps/set-ens-records.ts` — writes `x402.*` records via gateway admin API (Option 2b signed).
  - `steps/seed-gateway.ts` — seeds `agent_id_index` + `merchants.records` in gateway D1 via admin endpoint.
  - `justfile` recipe `onboard <ensName>`.
- `gateway/src/routes/admin/` directory:
  - `records.ts` — `POST /admin/records` signed-write endpoint.
  - `bootstrap.ts` — `POST /admin/bootstrap` infra-record seed (Reckon402-signed).
  - `auth.ts` — signature verification (ENS `owner(node)` + Reckon402 key).
- `gateway/src/ens/owner-lookup.ts` — ENS registry `owner(node)` reader
  against Ethereum Sepolia.
- `apps/frontend/` new package:
  - `index.html` — onboarding form + dashboard (single page).
  - `src/onboard.ts` — client JS: form submit → POST to backend orchestrator → poll progress.
  - `src/dashboard.ts` — client JS: live-poll receipts, attestations, gateway lookup.
  - `src/api.ts` — small wrapper for onboarding-orchestrator + gateway queries.
  - `wrangler.toml` — deploy as CF Pages / Worker Assets route.
- `workers/onboard-orchestrator/` new worker:
  - `src/index.ts` — HTTP API: `POST /onboard` (synchronous orchestration), `GET /onboard/:id/status` (progress poll).
  - Wraps the same logic as the CLI `tools/onboard/onboard.ts`, reusable in server-side context.
  - Wrangler secrets: Reckon402 EOA PK, ENS funder PK (both via Infisical).
- `gateway/migrations/0003_l4c_signed_writes.sql` — schema for
  `record_updates` audit log + ACL policy table.
- Tests: vitest for gateway admin routes + signed-writes; vitest for
  onboard orchestrator; playwright or cypress for frontend (cut to manual
  smoke per scope-cut priority #4 if tight).
- `tools/integration-tests/full-flow-l4c-onboard.sh` — end-to-end smoke
  (onboard a fresh `seller9.reckon402-test.eth` → paid call → assert trust
  count + gateway discount).
- `AGENTS.md ## L4c Onboarding + signed writes + frontend` section.

**What Spec 08B does NOT ship:**

- No SplitterFactory (that's 08A).
- No zkTLS, delivery-proof, or reverse-proxy. Post-hackathon per
  `zktls_spike.md` + `post_hackathon_delivery_proof.md`.
- No production-grade frontend styling. Ships with minimal CSS; polish
  cut per scope-cut priority order.
- No mainnet `reckon402.eth`. Sepolia only unless scope-cut item #3 is
  skipped.
- No KH integration beyond README mention (per `feedback_keeperhub.md`).
- No dispute flow, no refund path.
- No multi-SellingAgent side-by-side dashboard (demo is one-SellingAgent
  per `demo_narrative.md`).
- No per-SellingAgent dashboard persistence beyond what the gateway + D1
  already expose. Dashboard is a thin client.

---

## 2. Actor / act extensions

New acts introduced. Matrix D-decisions unchanged.

| Act | Off-chain / on-chain | Signer | Broadcaster | Gas payer |
|-----|----------------------|--------|-------------|-----------|
| A15. `ENSRegistry.setSubnodeOwner(parentNode, labelhash, newOwner)` | on-chain | Reckon402 ENS funder (parent-name owner) | Reckon402 | Reckon402 |
| A16. `PublicResolver.setAddr(subnode, sellingAgentEOA)` | on-chain | Reckon402 (if still parent-owner at write time) OR SellingAgent (post-transfer) | Same | Same |
| A17. `IdentityRegistry.registerAgent(tokenURI)` | on-chain | Reckon402 deployer (registers on behalf) OR SellingAgent | Same | Same |
| A18. Gateway `POST /admin/records` (signed-write) | off-chain | SellingAgent OR Reckon402 (per-key) | n/a | n/a |
| A19. Gateway `POST /admin/bootstrap` (infra seed) | off-chain | Reckon402 | n/a | n/a |

**Per-key ACL** (per `ens_record_ownership_split.md`):

| Key | Writer |
|-----|--------|
| `x402.splitter` | Reckon402 |
| `x402.facilitator` | Reckon402 |
| `x402.erc8004.registry` | Reckon402 |
| `x402.erc8004.agent_id` | Reckon402 |
| `x402.amount` | SellingAgent |
| `x402.pricing` | SellingAgent |
| `x402.endpoint` | SellingAgent |
| `x402.attestation` | SellingAgent |
| `x402.yield` | SellingAgent |

---

## 3. Onboarding script — 5 steps, exact contracts

### 3.1 CLI entrypoint

File: `tools/onboard/onboard.ts`.

```ts
#!/usr/bin/env node
// Usage: tsx tools/onboard/onboard.ts --name seller9.reckon402-test.eth \
//          --seller-eoa 0x... --endpoint https://seller9.example.com \
//          --amount 100000 --recipients 0x... --bps 10000

interface OnboardArgs {
  name: string                    // full ENS name, e.g. "seller9.reckon402-test.eth"
  sellerEoa: `0x${string}`        // SellingAgent's own EOA — becomes subname owner + recipients[0]
  endpoint: string                // HTTPS URL where the SellingAgent serves paid requests
  amount: string                  // atomic USDC base units, e.g. "100000" = 0.10 USDC
  recipients?: `0x${string}`[]    // optional split recipients; default = [sellerEoa]
  bps?: number[]                  // optional BPS; default = [10_000]
  progressSink?: (step: OnboardStep) => void  // for server-side orchestrator polling
}

interface OnboardStep {
  id: 1 | 2 | 3 | 4 | 5
  label: string
  txHash?: `0x${string}`
  externalLink?: string
  startedAt: number
  completedAt?: number
  error?: string
}

export async function onboard(args: OnboardArgs): Promise<OnboardResult>
```

**Result shape:**

```ts
interface OnboardResult {
  ensName: string
  sellerEoa: `0x${string}`
  agentId: bigint
  splitter: `0x${string}`
  splitterDeployTx: `0x${string}`
  subnameRegisterTx: `0x${string}`
  agentRegisterTx: `0x${string}`
  steps: OnboardStep[]
}
```

### 3.2 Step 1 — Mint ENS subname

File: `tools/onboard/steps/mint-subname.ts`.

On-chain act: `ENSRegistry.setSubnodeOwner(parentNode, keccak256(label), newOwner)`.

- `parentNode = namehash("reckon402-test.eth")`
- `label = "seller9"` (the subname prefix)
- `newOwner = sellerEoa` — transfers subnode ownership to the SellingAgent
  immediately.

**Caveat handled per l4c memory `Risk 1`:** writes to the subname's
resolver + addr records must happen BEFORE ownership transfer, OR after
the SellingAgent signs follow-up txs. We keep it simple:

1. `setSubnodeOwner` with `newOwner = Reckon402-ENS-funder` (temporary).
2. `setResolver(subnode, Reckon402Resolver)` — so CCIP-Read serves records.
3. `setAddr(subnode, sellerEoa)` — so wallet UIs resolve the name.
4. After Spec 08B §3.5 (set ENS records) completes, issue final
   `setOwner(subnode, sellerEoa)` — transfers final ownership to
   SellingAgent.

This ordering is non-trivial and must be explicit in the script. Comment
the rationale inline.

**Exact viem calls:** use `sepolia` chain (Ethereum Sepolia) with
`ETH_SEPOLIA_RPC_PRIMARY`. ENS Registry
`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`. `Reckon402Resolver`
`0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a`.

### 3.3 Step 2 — Deploy Splitter via Spec 08A factory

File: `tools/onboard/steps/deploy-splitter.ts`.

On-chain act: call `SplitterFactory.createSplitter(sellerEoa, recipients, bps, salt)` on Base Sepolia.

```ts
const salt = keccak256(toBytes(args.name))   // deterministic per ENS name
const recipients = args.recipients ?? [args.sellerEoa]
const bps = args.bps ?? [10_000]
const predicted = await readContract({
  address: env.SPLITTER_FACTORY_ADDRESS,
  abi: FACTORY_ABI,
  functionName: 'predictAddress',
  args: [salt, recipients, bps],
})
// If already deployed (re-onboard scenario), skip deploy and use predicted.
const deployed = await readContract({ ..., functionName: 'isDeployed', args: [predicted] })
if (!deployed) {
  const tx = await writeContract({
    address: env.SPLITTER_FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'createSplitter',
    args: [args.sellerEoa, recipients, bps, salt],
    account: reckon402DeployerAccount,
  })
  await publicClient.waitForTransactionReceipt({ hash: tx })
}
return { splitter: predicted, tx: tx ?? '0x' }
```

### 3.4 Step 3 — Register ERC-8004 agentId

File: `tools/onboard/steps/register-agent-id.ts`.

On-chain act: `IdentityRegistry.registerAgent(tokenURI)` on Base Sepolia.

- Registry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- `tokenURI` = `"https://gateway.reckon402.com/agents/{ensName}/metadata.json"`
  (metadata served by gateway; schema minimal — name, endpoint, created_at).
- `msg.sender` = Reckon402 deployer. The deployed agentId NFT is then
  transferred via `safeTransferFrom` to the SellingAgent's EOA in a second
  tx.

**Alternative simpler path:** if upstream IdentityRegistry supports
`registerAgentFor(owner, tokenURI)`, use that to skip the transfer. Verify
against the pinned commit `0463311492b3a7fc5fdb6990231cce721ff6cf97`
before implementation.

Return the freshly-minted `agentId` (bigint).

### 3.5 Step 4 — Set ENS records via gateway admin (signed-writes)

File: `tools/onboard/steps/set-ens-records.ts`.

**Off-chain act** (A19 infra bootstrap): Reckon402-signed `POST /admin/bootstrap`
writes:

| Key | Value (example) |
|-----|-----------------|
| `x402.splitter` | `0x<splitter-from-step-2>` |
| `x402.facilitator` | `https://facilitator.reckon402.com` |
| `x402.erc8004.registry` | `eip155:84532:0x8004B663…` (CAIP-2 ENSIP-25) |
| `x402.erc8004.agent_id` | `<agentId from step 3>` |

**Off-chain act** (A18 SellingAgent-owned): second call with same endpoint
writes merchant-owned records. Writer = Reckon402 deployer because the
script holds no SellingAgent private key. **But this violates the
ownership model!** Resolution:

- The onboarding script uses Reckon402 key for BOTH admin calls during
  onboarding. This is a bootstrap privilege: when the subnode is created,
  Reckon402 temporarily owns it (step 1 sub-step a). After this step
  writes the initial merchant records, step 1 sub-step d transfers
  ownership to the SellingAgent.
- **From that moment on, `POST /admin/records` for merchant-owned keys
  requires a signature from `owner(node)` — which is now the SellingAgent.**
  Reckon402 can no longer write `x402.amount`. Gateway enforces this
  via A18 ACL.

So the onboarding script pre-seeds merchant records with bootstrap values
(amount from CLI arg, pricing default, etc.), then transfers ownership.
Post-onboarding updates require the SellingAgent to use the
record-update UI or sign directly.

### 3.6 Step 5 — Seed gateway cache

File: `tools/onboard/steps/seed-gateway.ts`.

Off-chain act: `POST /admin/bootstrap/gateway-seed` (Reckon402-signed).
Inserts into gateway D1:
- `agent_id_index`: `(ens_name, chain_id, agent_id)` triple.
- `merchants`: the records JSON (same JSON shape as L4a₂'s
  `seed_l4a2.sql`).

This exists because:
- L4a₂ read path looks up `agent_id_index` for reputation reads.
- Merchant records table is the source of truth for static ENS records
  served by the CCIP-Read gateway.

**Idempotent:** uses `INSERT OR REPLACE`. Re-running onboarding with the
same ENS name updates the records without blowing up.

### 3.7 Atomicity / rollback

No transactional boundary across on-chain and off-chain steps. If step N
fails, prior steps stay committed. Script prints a resumable continuation
command. Explicit design — rolling back an on-chain tx is expensive and
the hackathon operator (us) can re-run selectively.

**Structured log output**: one JSON blob per step (`{id, label, txHash?, error?}`)
consumed by the server-side orchestrator for dashboard polling.

---

## 4. Gateway admin endpoints

### 4.1 Signed-write endpoint

Route: `POST /admin/records`.

Request body:

```json
{
  "ensName": "seller9.reckon402-test.eth",
  "key": "x402.amount",
  "value": "95000",
  "nonce": "0x<32-hex>",
  "signature": "0x<130-hex>"
}
```

Signature verification flow:

1. Compute `digest = keccak256(abi.encode(chainId, ensName, key, value, nonce))`.
2. Recover signer via `ecrecover(digest, signature)`.
3. Lookup the required writer for this key using the ACL table (§2).
4. If writer == "Reckon402": require signer to match Reckon402's
   onboarding EOA (env `RECKON402_ONBOARDING_EOA`).
5. If writer == "SellingAgent": compute `ensNode = namehash(ensName)`;
   lookup `owner(ensNode)` via `gateway/src/ens/owner-lookup.ts` against
   Ethereum Sepolia; require signer to match owner.
6. Check nonce uniqueness: `INSERT INTO record_updates (ens_name, key, nonce, ...)`
   with UNIQUE constraint on `(ens_name, nonce)`. Replay = reject.
7. On success, update `merchants.records` JSON with the new key/value;
   write audit row into `record_updates`; invalidate gateway cache via
   internal hook.

Response:
- `200 {txHash: null, updated: true, recordKey, updatedAt}` — note
  `txHash: null` because writes are off-chain; "txHash" field is
  forward-compat for a future on-chain write mode.
- `401` — signature mismatch.
- `403` — ACL violation (e.g., SellingAgent tried to write `x402.splitter`).
- `409` — replay (nonce reused).
- `422` — malformed key / value / ENS name.

### 4.2 Bootstrap endpoint (Reckon402-only)

Route: `POST /admin/bootstrap`.

Batch-seeds records at onboarding time. Requires signature from
`RECKON402_ONBOARDING_EOA`. Accepts infra-keys + merchant-keys in one
call. After bootstrap succeeds, subsequent writes to merchant-keys by
Reckon402 are rejected — the ACL enforcement re-activates once the ENS
subnode ownership has been transferred.

Gateway detects "subnode ownership transfer" by reading
`owner(namehash(ensName))` on each admin call; if owner ≠ Reckon402 EOA,
merchant-keys require SellingAgent sig. If owner == Reckon402 EOA (pre-
transfer), bootstrap window is open.

This gives a clean one-way door: ownership transfer closes bootstrap.

### 4.3 Gateway-seed endpoint

Route: `POST /admin/bootstrap/gateway-seed`.

Same auth as `/admin/bootstrap`. Seeds `agent_id_index` + `merchants`
tables directly. Body:

```json
{
  "ensName": "seller9.reckon402-test.eth",
  "chainId": 84532,
  "agentId": "3",
  "records": { "x402.amount": "100000", ... }
}
```

### 4.4 ENS owner-lookup module

File: `gateway/src/ens/owner-lookup.ts`.

```ts
export async function getEnsOwner(
  env: { ETH_SEPOLIA_RPC_PRIMARY: string },
  ensName: string,
): Promise<`0x${string}` | null>
```

Computes `namehash(ensName)`, calls `ENSRegistry.owner(node)` on Ethereum
Sepolia. Returns null on any failure (RPC down, malformed name). Caller
treats null as "ACL check fails" (deny by default).

Cached with 60s TTL in gateway D1 (ownership changes are rare; 60s
lag is acceptable for our operator pace).

---

## 5. D1 schema delta (migration 0003)

File: `gateway/migrations/0003_l4c_signed_writes.sql`.

```sql
-- L4c signed-writes audit log. Every record write is replayed-guarded
-- via (ens_name, nonce) UNIQUE.
CREATE TABLE IF NOT EXISTS record_updates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ens_name      TEXT NOT NULL,
  record_key    TEXT NOT NULL,
  record_value  TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  signer_addr   TEXT NOT NULL,
  written_at    INTEGER NOT NULL,
  UNIQUE (ens_name, nonce)
);

CREATE INDEX IF NOT EXISTS idx_record_updates_ens
  ON record_updates (ens_name, written_at DESC);

-- ENS owner cache — 60s TTL keyed by namehash(ensName).
CREATE TABLE IF NOT EXISTS ens_owner_cache (
  ens_name    TEXT PRIMARY KEY,
  owner_addr  TEXT NOT NULL,
  cached_at   INTEGER NOT NULL
);
```

No change to `merchants` table (existing L4a₁/L4a₂ schema holds records
JSON in-place; signed-writes mutate that JSON).

---

## 6. Frontend

### 6.1 Shape

Single HTML page with two views:

- **Onboarding view** (default): form with fields for ENS label,
  SellingAgent EOA, endpoint URL, amount. `[Deploy]` button.
- **Dashboard view** (loads after deploy OR when navigating to
  `/agent/{ensName}`): shows the SellingAgent's full state.

Technology: vanilla TS + HTML + minimal CSS. No framework (React/Vue)
for the hackathon. Rationale per `l4c_scope_timeline.md`: WebSocket
live-updates are cut; fetch polling at 3s interval is sufficient.

### 6.2 Onboarding flow (client JS)

1. User fills form → clicks Deploy.
2. Client POSTs to `onboard-orchestrator.reckon402.com/onboard` with
   form fields.
3. Orchestrator returns `{onboardId}` immediately (fire-and-forget the
   chain ops via CF Worker waitUntil).
4. Client polls `GET /onboard/{onboardId}/status` every 1s.
5. Each status response includes `steps[]`; client renders progress
   panel with a green check for completed steps and `externalLink`
   (Basescan/Etherscan URL) for each.
6. Once all 5 steps complete, client redirects to `/agent/{ensName}`.

### 6.3 Dashboard view

Reads (all via polling):

- **From gateway**: `GET /lookup/{ensName}/x402.amount?backend=erc8004`
  → current price (with reputation discount applied). Shown in the
  Option C terminal pane.
- **From gateway**: `GET /lookup/{ensName}/x402.erc8004.agent_id` →
  agentId.
- **From facilitator**: `GET /receipts?merchantEns={ensName}&limit=20`
  → list of recent receipts with settle/attestation tx hashes.
- **From Base Sepolia RPC** (direct via public provider): `ReputationRegistry.getSummaryForAllClients(agentId, [facilitatorAddr])`
  → feedback count; compute trust-badge tier.

Layout:

```
+----------------------------------------------------------+
| SellingAgent: seller9.reckon402-test.eth      [Run Call] |
+----------------------------------------------------------+
| ENS addr:   0x...                                        |
| agentId:    3                                            |
| Splitter:   0x...  (Basescan link)                       |
| Endpoint:   https://seller9.example.com/hello            |
|                                                          |
| Tier config:                                             |
|   0 feedback  → base  (active)                           |
|   1–2         → 5% off                                   |
|   3–9         → 10% off                                  |
|   10+         → 15% off                                  |
|                                                          |
| Trust count: 0  [ gray badge ]                           |
|                                                          |
| Call log:                                                |
|   (none yet)                                             |
+----------------------------------------------------------+
| $ curl gateway.reckon402.com/lookup/seller9…/x402.amount |
| > {"value":"100000"}                                     |
+----------------------------------------------------------+
```

After 3 paid calls:

```
| Trust count: 3  [ bronze badge ]                         |
|                                                          |
| Call log:                                                |
|   14:32:11  0xabc…  settle:0xdef…  attest:0x123…         |
|   14:32:25  0x…                                          |
|   14:32:40  0x…                                          |
+----------------------------------------------------------+
| $ curl gateway.reckon402.com/lookup/seller9…/x402.amount |
| > {"value":"90000"}                                      |
+----------------------------------------------------------+
```

### 6.4 Run-call button

Dashboard has `[Run Test Call]` button. Triggers a paid call via the
existing L4b₁ `@reckon402/buyer-sdk` hosted signing wrapper. Calls
`seller9.example.com` endpoint with 0.10 USDC payment. Receipt appears in
call log on next poll.

Budget for a real endpoint at `seller9.example.com`: use the existing
`agent.reckon402.com/research` endpoint as the stand-in. The demo story
doesn't require a literally-fresh endpoint per onboard — the ENS name
points at an existing running service. Judges see the ENS resolution
work, settlement tx, attestation tx.

### 6.5 Video-fallback prep (from `l4c_scope_timeline.md`)

Before Saturday 12pm, record a 90s video of the full flow (button →
progress → dashboard → 3 calls → price change in terminal pane) using
OBS or similar. Keep ready to play if live-demo latency is rough.

---

## 7. Test plan

### 7.1 Vitest — gateway admin routes

File: `gateway/test/admin-records.test.ts`.

| # | Case | Asserts |
|---|------|---------|
| 1 | Valid SellingAgent signature on `x402.amount` | 200; `merchants.records` updated; `record_updates` row inserted |
| 2 | Reckon402 signature on `x402.amount` (ACL violation) | 403 |
| 3 | SellingAgent signature on `x402.splitter` (ACL violation) | 403 |
| 4 | Reckon402 signature on `x402.splitter` during bootstrap window | 200 |
| 5 | Reckon402 signature on `x402.splitter` after ownership transferred | 403 |
| 6 | Replay attack — same nonce twice | First 200, second 409 |
| 7 | Malformed ENS name | 422 |
| 8 | ENS owner-lookup RPC fails | 503 (deny by default) |
| 9 | Signature invalid (wrong chainId in digest) | 401 |
| 10 | Empty value | 422 |

Each test mocks the ENS owner-lookup; live-RPC tests hit Ethereum Sepolia
in a separate live-test file (skipped when RPC not configured).

### 7.2 Vitest — onboard orchestrator

File: `workers/onboard-orchestrator/test/orchestrator.test.ts`.

| # | Case | Asserts |
|---|------|---------|
| 1 | Happy path (all 5 steps) | Calls each step module in order; returns full `OnboardResult`; steps array populated with timestamps |
| 2 | Step 2 (deploy-splitter) already deployed | Skips deploy; uses `predictAddress` result |
| 3 | Step 3 fails (RPC timeout) | Returns partial result with `error` on step 3; steps 1–2 still recorded |
| 4 | Progress sink callback invoked | Every step transition emits to `progressSink` |
| 5 | Idempotent re-run same ENS name | Second run detects existing subname, existing splitter, existing agentId; emits no-op steps |

### 7.3 Vitest — onboard step modules

One file per step. Most important:

- `tools/onboard/test/mint-subname.test.ts` — asserts tx signed with
  funder key, correct parent-node, ordering of setSubnodeOwner →
  setResolver → setAddr → setOwner-transfer.
- `tools/onboard/test/deploy-splitter.test.ts` — asserts
  `predictAddress` round-trip; skips deploy if already deployed.
- `tools/onboard/test/register-agent-id.test.ts` — asserts
  registerAgent call then safeTransferFrom to SellingAgent.
- `tools/onboard/test/set-ens-records.test.ts` — asserts bootstrap call
  sets all infra + initial merchant records with one POST.
- `tools/onboard/test/seed-gateway.test.ts` — asserts D1 INSERT OR
  REPLACE on both tables.

### 7.4 Integration smoke — `full-flow-l4c-onboard.sh`

```bash
# Preconditions: Spec 08A deployed + green.
# SellingAgent EOA funded with ETH on Ethereum Sepolia AND Base Sepolia.

just onboard seller9.reckon402-test.eth \
  --seller-eoa "$SELLER9_EOA" \
  --endpoint https://agent.reckon402.com/research \
  --amount 100000

# Assert all 5 tx hashes returned.
# Assert gateway returns records:
curl -fsS "https://gateway.reckon402.com/lookup/seller9.reckon402-test.eth/x402.amount" | jq '.value' # "100000"
curl -fsS "https://gateway.reckon402.com/lookup/seller9.reckon402-test.eth/x402.splitter" | jq '.value' | grep -c '^0x'
curl -fsS "https://gateway.reckon402.com/lookup/seller9.reckon402-test.eth/x402.erc8004.agent_id" | jq '.value' # bigint

# Paid call.
bash tools/integration-tests/full-flow-l4b.sh --merchant seller9.reckon402-test.eth

# Assert discount applied on next read.
curl -fsS "https://gateway.reckon402.com/lookup/seller9.reckon402-test.eth/x402.amount?backend=erc8004" | jq '.value'
# Expect 95000 (5% off base 100000 after 1 attestation)
```

### 7.5 Frontend — manual smoke

No automated frontend tests for hackathon budget. Manual smoke list:

- Form submission triggers POST; dashboard renders progress steps.
- Each step's Basescan link opens a valid explorer URL.
- Dashboard post-onboard shows ENS name, agentId, Splitter, endpoint.
- `[Run Test Call]` button triggers a paid call; receipt appears in log.
- Terminal pane updates with new `x402.amount` value after first call.

Record Saturday 12pm during dress rehearsal.

---

## 8. Deployment checklist

1. Apply `gateway/migrations/0003_l4c_signed_writes.sql` to
   `reckon402-d1-gateway-dev`.
2. `wrangler secret put RECKON402_ONBOARDING_EOA` (address only; pubkey).
3. `wrangler deploy` gateway with new admin routes.
4. Deploy `workers/onboard-orchestrator` as new CF Worker with
   Infisical-piped Reckon402 funder PK + deployer PK secrets.
5. Deploy `apps/frontend` to CF Pages at `app.reckon402.com`.
6. DNS: CNAME `app.reckon402.com` → CF Pages project.
7. Smoke: run `full-flow-l4c-onboard.sh` against staging.
8. Smoke: open `app.reckon402.com` in browser, onboard `seller10.reckon402-test.eth` end-to-end.
9. Tag `L4c-onboarding-green` pushed.
10. Update `AGENTS.md ## L4c Onboarding + signed writes + frontend` with:
    - orchestrator + gateway version IDs,
    - one onboarded seller example tx hashes,
    - frontend URL.

---

## 9. Open questions

**Q-08B-1 — SellingAgent key in demo.** The dashboard's `[Run Test Call]`
signs as the BuyingAgent (existing KMS signing wrapper from L4b₁
`signing.reckon402.com`). The SellingAgent in our demo doesn't need to
actually sign record-updates during the demo — the terminal pane just
reads. Post-onboard, updating merchant records would require the
SellingAgent's key; for the demo we skip that flow entirely.

**Q-08B-2 — Frontend hosting.** CF Pages is the default. Alternative:
serve from the gateway Worker. Defer decision to implementation agent;
both work.

**Q-08B-3 — Multi-merchant dashboard URL routing.** The dashboard at
`/agent/{ensName}` parametrizes the merchant. Required for post-demo
exploration even though demo is one-merchant. Keep in scope (cheap).

**Q-08B-4 — ENS subname name collision.** If the operator attempts
`just onboard seller1.reckon402-test.eth` and `seller1` already exists,
the script detects and either (a) errors with "already onboarded; use
--force-replace" or (b) silently no-ops. Default: (a). Safer.

**Q-08B-5 — Orchestrator timeout.** CF Workers `waitUntil` budget is
30s typical. Five on-chain txs may take longer. Mitigation: orchestrator
does NOT wait for tx receipts in the request path; it returns `onboardId`
immediately and processes in `waitUntil`. Dashboard polls for progress.
Each step updates orchestrator D1 row. If total runtime > 30s Worker
budget per invocation, schedule next step in a Queue.

---

## 10. Definition of done

- [ ] `tools/onboard/onboard.ts` CLI runs 5 steps in order; live-tested against Sepolia + Base Sepolia.
- [ ] All five step modules have vitest coverage with full argument assertions.
- [ ] `gateway/src/routes/admin/records.ts` with 10/10 vitest cases green.
- [ ] `gateway/src/routes/admin/bootstrap.ts` with Reckon402-signed tests.
- [ ] `gateway/src/ens/owner-lookup.ts` module + tests (unit + one live RPC test).
- [ ] `gateway/migrations/0003_l4c_signed_writes.sql` applied staging + prod.
- [ ] `workers/onboard-orchestrator/` deployed with orchestrator tests green.
- [ ] `apps/frontend/` deployed to CF Pages; manual smoke list all green.
- [ ] `full-flow-l4c-onboard.sh` end-to-end green from clean state.
- [ ] `just onboard` recipe exposed and documented.
- [ ] Saturday dress-rehearsal recording captured (90s video fallback).
- [ ] `AGENTS.md ## L4c Onboarding + signed writes + frontend` committed.
- [ ] Annotated tag `L4c-onboarding-green` pushed.

---

## 11. Hour budget

20h for this spec (= 30h L4c total − 10h for 08A):

- Onboarding script (5 steps + CLI + orchestrator wrap): 6h
- Signed-writes gateway + ENS owner-lookup + tests: 6h
- Frontend template + dashboard + manual smoke: 8h

Zero slack. If we hit 25h trigger cut-priority per `l4c_scope_timeline.md`:
1. Dashboard polling → page-refresh only.
2. Signed writes → trusted-admin for pricing (2a) + sig-verify only on infra.
4. Frontend polish → terminal commands only (HTML skeleton).

---

## 12. Integration with Spec 08A

Spec 08A is a runtime dependency:
- Onboarding step 2 calls `SplitterFactory.createSplitter` from 08A.
- Facilitator's per-payment splitter resolution (08A §4.2) reads the
  records that this spec's onboarding script writes.

**Integration smoke (post both specs green)**: run a single `full-flow-l4c.sh`
that chains `onboard` → `run-call` → assert discount. If either spec
slips, this end-to-end fails visibly.

**Parallel execution compatibility:** this spec's implementation does
NOT need 08A's code to land first. All 08A interactions in this spec
are via ABI (factory address + function signature). Implementation can
proceed against a mocked factory; integration smoke requires 08A
deployed on Base Sepolia.

---

## 13. References

- `specs/06-actor-act-matrix.md` — D1–D14 locks.
- `specs/07-l4b-erc8004-writes.md` — L4b₁ attestation contract (inherited).
- `specs/08a-l4c-factory-refactor.md` — factory + per-payment resolution (consumed).
- `packages/erc-8004-client/` — library for IdentityRegistry + ReputationRegistry.
- `gateway/src/resolution/` — existing L4a₁/L4a₂ read path.
- Memory: `terminology.md`, `l4c_scope_timeline.md`, `ens_record_ownership_split.md`, `ensip25_erc8004.md`, `demo_narrative.md`, `zktls_spike.md`, `post_hackathon_delivery_proof.md`.
