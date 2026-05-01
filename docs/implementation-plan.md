# Reckon402 — Implementation Plan: Demo Completion Sprint
# ETHGlobal OpenAgents 2026 — 2 days remaining (2026-05-01 → 2026-05-03)
#
# REVISED after Opus 4.7 adversarial review + hands-on secrets/code audit.
# Every defect below is verified against the live codebase and Infisical secrets.

> **Revert point:** tag `design-locked-2026-05-01` (commit bb3c7c5)  
> **Design doc:** `docs/demo-design.md`  
> **Existing deploy runbook:** `tools/deploy/deploy-l4c-onboarding.md`

---

## Verified secrets inventory (as of 2026-05-01)

| Secret name | Status | EOA / value |
|-------------|--------|-------------|
| `X402COMMIT_FUNDER_PK` | ✓ EXISTS | `0x9AF7...` — owns `reckon402-test.eth` on ETH Sepolia; 3.9 ETH Sepolia + 2.5 ETH Base Sepolia |
| `SELLER_PK` | ✓ EXISTS | `0xD53f...` — SellingAgent demo EOA; **0 ETH on both chains — must fund before Phase 1** |
| `FACILITATOR_PK` | ✓ EXISTS | `0x0A02...` — 1 ETH Base Sepolia; usable as `RECKON402_DEPLOYER_PK` |
| `ADMIN_TOKEN` | ✓ EXISTS (wrangler secret, 32 chars) | Bearer token for `/admin/receipts` — see IP-4 |
| `ETH_SEPOLIA_RPC_PRIMARY` | ✓ EXISTS | length 58 |
| `BASE_SEPOLIA_RPC_PRIMARY` | ✓ EXISTS | (from prior runs) |
| `RECKON402_DEPLOYER_PK` | ✗ MISSING | Use `FACILITATOR_PK` — same EOA, plain hex, funded |
| `RECKON402_ONBOARDING_PK` | ✗ MISSING | Use `SELLER_PK` — same EOA as the demo SellingAgent |
| `ENS_FUNDER_PK` | ✗ MISSING | Use `X402COMMIT_FUNDER_PK` — confirmed ENS parent owner |

**Resolution:** All three missing secrets are aliases of existing keys. No new key generation needed. Phase 1 Step 0 registers them as aliases in Infisical.

---

## Production defects on `main` that must be fixed before Phase 1

These exist in the live codebase today. The demo fails silently without them.

### IP-1 — `extra.ens` never reaches the facilitator (PRODUCTION BLOCKER)

**File:** `packages/middleware-hono/src/withX402.ts` lines 23–31 and 97–105

The middleware hardcodes `extra: { name: 'USDC', version: '2' }` in both the
402 response AND the `requirements` object passed to `facilitator.settle()`.
It never reads the buyer's `payload.accepted.extra`.

The facilitator's `settle-route.ts:137-147` requires `paymentRequirements.extra.ens`
when `ENABLE_L4C_FACTORY="true"`, returning HTTP 400 `MISSING_ENS` otherwise.

**Fix:** `withX402.ts` must accept an optional `extra` field in `X402Options`
and merge it into both the 402 response and the `requirements` object.
`agent/src/index.ts` must pass `extra: { ens: env.SELLER_ENS }` (a new env var)
to `withX402`.

**Impact if unfixed:** Every settle call returns 400. Demo dead.

### IP-2 — `just fullflow-l4b` regression gate fails due to IP-1 (not the gateway)

**File:** `justfile` — `fullflow-l4b` calls `full-flow-l3.sh` which hits the agent endpoint.

Phase 1 Step 3 uses `just fullflow-l4b` as the regression gate after deploying the
gateway. With IP-1 live, this gate is already failing — the test failure is IP-1,
not a gateway regression. **Fix:** use `just fullflow-l4c-factory` as the Phase 1
regression gate instead (bypasses the agent middleware, exercises only the
facilitator and gateway directly).

### IP-3 — `auth.to` ≠ resolved splitter → silent settlement failure (PRODUCTION BLOCKER)

**Files:** `workers/agent/wrangler.toml`, `workers/facilitator/src/settle.ts`

`agent/wrangler.toml` has `SPLITTER_ADDRESS = "0x0ad507..."` (legacy L3 splitter).
This is what the agent passes as `payTo` / `recipient` to the middleware — so
the buyer signs `auth.to = 0x0ad507...`.

`settle.ts:80` uses `input.splitter ?? env.SPLITTER_ADDRESS` for the post-transfer
balance poll and `distribute()` call. `input.splitter` = `0x372c0b...` (factory
splitter, resolved via ENS). `auth.to` = `0x0ad507...`.

The USDC transfer lands in `0x0ad507...` (what the buyer signed). The facilitator
polls balance on `0x372c0b...`. Balance stays at 0. Times out after 30s →
`FAILED` state. No attestation.

**Fix:** `agent/wrangler.toml` must set `SPLITTER_ADDRESS = "0x372c0b951035da05058b175a15b4fe7d29f1fc4c"` 
(the factory-deployed splitter for `seller.reckon402-test.eth`). This makes
`auth.to == resolved splitter` so USDC lands in the right contract and the
balance poll succeeds.

**Note:** This fix means the agent is hardcoded to one SellingAgent's splitter.
For demo purposes this is fine — the agent serves `seller.reckon402-test.eth`.
The long-term fix is having the agent fetch `x402.splitter` from the gateway at
request time, but that is post-hackathon scope.

### IP-4 — `/admin/receipts` is auth-gated and has camelCase field names; dashboard reads neither correctly

**Two sub-problems:**

**IP-4a (auth):** `admin-route.ts:18-24` requires `Authorization: Bearer <ADMIN_TOKEN>`.
`ADMIN_TOKEN` is a wrangler secret (set, 32 chars). The dashboard fetches
`/admin/receipts` with no auth header → always 401 → call log always shows "no calls yet".

**IP-4b (field names):** Admin route returns `tx`, `tdErc8004Tx`, `paymentId`, `submittedAt`.
Dashboard reads `transaction`, `td_erc8004_tx`, `payment_id`, `submitted_at`.
Every field is wrong — clickable links always `—`, trust counter always 0.

**Fix options for IP-4a:**
- Option A: Add a proxy endpoint on the orchestrator (`GET /receipts?limit=N`) that
  forwards to the facilitator with the Bearer token server-side. Dashboard calls the
  orchestrator (same origin, no CORS). Token stays secret. **Recommended — 20 min.**
- Option B: Make `ADMIN_TOKEN` a public `[var]` and embed it in `app.js`. Bad security
  practice, but acceptable for a hackathon with no real funds at risk.
- Option C: Add a separate unauthenticated read-only receipts endpoint to the facilitator.
  Clean but requires deploying the facilitator.

**Fix for IP-4b:** Update `app.js` field references to use `tx`, `tdErc8004Tx`,
`paymentId`, `submittedAt`. Same in `demo/index.html` if it reads `/admin/receipts`.

---

## Phase 0 — Pre-flight (15 min, before anything else)

```
0a. Register missing secret aliases in Infisical:
    ENS_FUNDER_PK         = value of X402COMMIT_FUNDER_PK
    RECKON402_DEPLOYER_PK = value of FACILITATOR_PK
    RECKON402_ONBOARDING_PK = value of SELLER_PK

    (These are the same key material under the names the orchestrator expects.
    No new keys needed. Fund SELLER on Base Sepolia and ETH Sepolia — see 0b.)

0b. Fund SELLER_ADDRESS (0xD53f...) on both chains:
    - ETH Sepolia: ≥0.01 ETH (for potential future signed writes as ENS owner)
    - Base Sepolia: ≥0.01 ETH (in case any Base Sepolia ops are needed)
    Source: X402COMMIT_FUNDER has 2.5 ETH Base Sepolia — transfer from there.

    cast send 0xD53ffac42496d73B3Faf946786688a8454F57b1f \
      --value 0.02ether \
      --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" \
      --private-key "$X402COMMIT_FUNDER_PK"

0c. Verify FACILITATOR has enough Base Sepolia ETH for Splitter + agentId deploys:
    FACILITATOR (0x0A02...) = 1 ETH Base Sepolia ✓ (confirmed)
    Each onboarding costs ~0.005 ETH — has headroom for 200 runs.

0d. Confirm regression gate switch:
    Replace `just fullflow-l4b` with `just fullflow-l4c-factory` in Phase 1 Step 3.
```

---

## Phase 1 — Fix IP-1 + IP-3 + IP-4, then deploy `app.reckon402.com`

**These code fixes must land and deploy before the smoke tests will pass.**

### Step 1 — Fix IP-1: add `extra` pass-through to `withX402` middleware

**File:** `packages/middleware-hono/src/withX402.ts`

Add `extra?: Record<string, string>` to `X402Options`. Merge into both the
402 `PaymentRequirements` object and the `requirements` object passed to
`facilitator.verify()` and `facilitator.settle()`:

```diff
 export interface X402Options {
   amount: string
   network: string
   asset: string
   recipient: string
   facilitator: Facilitator
+  extra?: Record<string, string>
 }

 function buildPaymentRequired(url: string, opts: X402Options): XPaymentRequired {
   return {
     x402Version: 2,
     resource: { url },
     accepts: [
       {
         ...
-        extra: { name: 'USDC', version: '2' },
+        extra: { name: 'USDC', version: '2', ...opts.extra },
       } satisfies PaymentRequirements,
     ],
   }
 }

-  const requirements: PaymentRequirements = {
-    ...
-    extra: { name: 'USDC', version: '2' },
-  }
+  const requirements: PaymentRequirements = {
+    ...
+    extra: { name: 'USDC', version: '2', ...opts.extra },
+  }
```

### Step 2 — Fix IP-3: update agent `SPLITTER_ADDRESS` + add `SELLER_ENS` env var

**Files:** `workers/agent/wrangler.toml`, `workers/agent/src/index.ts`

```diff
# wrangler.toml
-SPLITTER_ADDRESS = "0x0ad507c6973eba86313794329ad9b12fbf24acd0"
+SPLITTER_ADDRESS = "0x372c0b951035da05058b175a15b4fe7d29f1fc4c"
+SELLER_ENS       = "seller.reckon402-test.eth"
```

```diff
# src/index.ts — in withX402 call
 const middleware = withX402({
   amount: c.env.AMOUNT,
   network: c.env.NETWORK,
   asset: c.env.USDC_ADDRESS,
   recipient: c.env.SPLITTER_ADDRESS,
   facilitator: new Reckon402Facilitator(c.env.FACILITATOR_URL),
+  extra: { ens: c.env.SELLER_ENS },
 })
```

Deploy agent worker after this change.

### Step 3 — Apply gateway D1 migration 0003

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd gateway
  wrangler d1 execute reckon402-d1-gateway-dev --remote \
    --file migrations/0003_l4c_signed_writes.sql
'
```

Verify 3 tables exist. Regression gate: `just fullflow-l4c-factory` (NOT fullflow-l4b).

### Step 4 — Wire `RECKON402_ONBOARDING_EOA` into gateway and orchestrator `wrangler.toml`

`RECKON402_ONBOARDING_EOA` = `0xD53ffac42496d73B3Faf946786688a8454F57b1f` (SELLER address,
derived from SELLER_PK = RECKON402_ONBOARDING_PK).

Edit `gateway/wrangler.toml` — all three `[vars]` blocks:
```diff
-RECKON402_ONBOARDING_EOA = ""
+RECKON402_ONBOARDING_EOA = "0xD53ffac42496d73B3Faf946786688a8454F57b1f"
```

Edit `workers/onboard-orchestrator/wrangler.toml` — both `[vars]` blocks:
```diff
-SPLITTER_FACTORY_ADDRESS = ""
-RECKON402_ONBOARDING_EOA = ""
+SPLITTER_FACTORY_ADDRESS = "0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7"
+RECKON402_ONBOARDING_EOA = "0xD53ffac42496d73B3Faf946786688a8454F57b1f"
```

Commit both.

### Step 5 — Deploy gateway

```bash
infisical run ... wrangler deploy --env production  # from gateway/
```

Verify: `curl /admin/records` → 400 (not 404). Verify: `just fullflow-l4c-factory` exits 0.

### Step 6 — Set orchestrator wrangler secrets (Infisical-piped)

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  cd workers/onboard-orchestrator
  printf "%s" "$X402COMMIT_FUNDER_PK"  | wrangler secret put ENS_FUNDER_PK           --env production
  printf "%s" "$FACILITATOR_PK"        | wrangler secret put RECKON402_DEPLOYER_PK   --env production
  printf "%s" "$SELLER_PK"             | wrangler secret put RECKON402_ONBOARDING_PK --env production
  printf "%s" "$ETH_SEPOLIA_RPC_PRIMARY"  | wrangler secret put ETH_SEPOLIA_RPC_PRIMARY --env production
  printf "%s" "$BASE_SEPOLIA_RPC_PRIMARY" | wrangler secret put BASE_SEPOLIA_RPC_PRIMARY --env production
'
```

Verify: `wrangler secret list --env production` shows 5 secrets.

### Step 7 — Deploy orchestrator worker

```bash
infisical run ... wrangler deploy --env production  # from workers/onboard-orchestrator/
```

Verify:
```bash
curl https://app.reckon402.com/healthz        # → {"ok":true}
curl https://app.reckon402.com/               # → 200 (index.html)
curl https://app.reckon402.com/app.js         # → 200
```

### Step 8 — First live onboarding (use smoke name, NOT seller9)

Use `seller-smoke-1` for this step so the demo name `seller9` remains available:

```bash
infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
  just onboard seller-smoke-1.reckon402-test.eth 0xD53ffac42496d73B3Faf946786688a8454F57b1f
'
```

### Step 9 — Automated smoke

```bash
just fullflow-l4c-onboard
```

Must exit 0. Captures smoke ENS name, post-attestation `x402.amount`.

### Step 10 — Deploy agent worker (IP-1 + IP-3 fix)

```bash
infisical run ... wrangler deploy  # from workers/agent/ — no --env flag needed
```

Verify: `just fullflow-l4b` now exits 0 (agent middleware fix restores this gate).

### Step 11 — Tag + push

```bash
git tag -a L4c-onboarding-green -m "..."
git push --follow-tags
```

---

## Phase 2 — UI additions (~2.5h coding, parallel agents after Phase 1 Step 7)

### 2A — `apps/frontend/dist/app.js` + `apps/frontend/dist/index.html` (Agent 1, ~90 min)

**A1. Fix IP-4b field names (5 min, do first)**
- `r.transaction` → `r.tx`
- `r.td_erc8004_tx` → `r.tdErc8004Tx`
- `r.payment_id` → `r.paymentId`
- `r.submitted_at` → `r.submittedAt`

**A2. Fix IP-4a: add orchestrator receipts proxy (20 min)**
Add `GET /receipts?limit=N` to `workers/onboard-orchestrator/src/index.ts`:
proxies to `facilitator.reckon402.com/admin/receipts` with the Bearer token
from a new secret `FACILITATOR_ADMIN_TOKEN`. Dashboard calls `/receipts` (same
origin, no CORS, no token exposed to browser).

Set the new wrangler secret:
```bash
printf "%s" "$ADMIN_TOKEN" | wrangler secret put FACILITATOR_ADMIN_TOKEN --env production
```

**A3. Dashboard: populate agentId / splitter / endpoint from records (15 min)**
- Fetch `GET /records/:ensName?flat=true&backend=static` → `gateway.reckon402.com`
- Map: `x402.erc8004.agent_id` → `#dash-agent-id`, `x402.splitter` → `#dash-splitter`,
  `x402.endpoint` → `#dash-endpoint`

**A4. ENS Text Records collapsible panel (20 min)**
- `<details>/<summary>` element after dashboard header — no extra JS
- Same fetch as A3 — render all keys in 2-col table, `0x` values as clickable links

**A5. "Run Test Call" button: open KeeperHub workflow URL (5 min)**
- Replace `alert()` with `window.open(CFG.KH_WORKFLOW_URL, '_blank')`
- Add `KH_WORKFLOW_URL` to `CFG` object (populated after Phase 3C)

**A6. BPS split display on onboard form (15 min)**
- Add a read-only section below the form fields showing the hardcoded split:
  `0xD53f... (seller) 97% / 0x0A02... (platform) 2% / 0x66C2... (deployer) 1%`

**A7. "Download KH Workflow" button on dashboard (20 min)**
- After onboarding succeeds and dashboard loads, generate a `kh-workflow.json`
  from the agent's ENS records (endpoint, amount, ENS name) and trigger browser download

### 2B — `demo/index.html` (Agent 2, ~45 min)

**B1. Boot-poll `/admin/receipts` (15 min)**
- On page load: fetch `facilitator.reckon402.com/admin/receipts?limit=20` with
  `Authorization: Bearer <ADMIN_TOKEN>` header
- ADMIN_TOKEN must be embedded here (demo page is static, no proxy available)
- Fix field names: `tx`, `tdErc8004Tx`, `paymentId`, `submittedAt`

**B2. Pause/Resume toggle (10 min)**

**B3. Agent Roster dropdown (20 min)**

### 2C — `recipes/kh-workflow.json` (Agent 3, 15 min)

- Add `"extra": {"ens": "${DEMO_SELLER_ENS}"}` to each call node's config
- Make `DEMO_SELLER_ENS` a KH workflow variable

---

## Phase 3 — Static deploys + KH publish (manual, ~40 min, user runs)

- 3A: CF Pages `reckon402.com` (follow `landing/DEPLOY.md`)
- 3B: CF Pages `demo.reckon402.com` — **after Phase 2B** so boot-poll is in the file
- 3C: KeeperHub publish (follow `tools/deploy/kh-platform-runbook.md`) — **after Phase 2C**

---

## Phase 4 — Demo rehearsal + submission (tomorrow)

```
Morning:
  Full demo run × 2 with fresh agents (seller9, seller10)
  Each run proves: form → 5 steps → dashboard → 3 KH calls → badge + price change
  Check: Option C terminal pane, demo.reckon402.com roster, reckon402.com landing

Mainnet go/no-go: only if testnet ran cleanly twice without intervention

Afternoon:
  Record video (target: <3 min)
  Fill docs/submission/draft.md TODO markers
  Submit
```

---

## Dependency graph (critical path)

```
Phase 0 (15 min, secrets + funding)
  ↓
Phase 1 Steps 1-2 (IP-1 + IP-3 code fixes in middleware + agent)
  ↓
Phase 1 Steps 3-7 (gateway migration → orchestrator deploy → app.reckon402.com live)
  ↓
Phase 1 Steps 8-9 (live onboard + smoke)
  ↓
Phase 1 Step 10 (deploy agent with IP-1+IP-3 fix)
  ↓
Phase 2 (parallel agents: A=frontend, B=demo page, C=kh-workflow)
  ↓
Re-deploy orchestrator (2A changes) + static deploy demo page (2B) + KH publish (2C)
  ↓
Phase 4 rehearsal
```

Phase 3A (`reckon402.com`) is independent — any time.

---

## Risk register (post-review, verified)

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | Three secret names missing from Infisical | HIGH | **RESOLVED** — aliases of existing keys |
| 2 | `RECKON402_DEPLOYER_PK` needs plain hex, not KMS | HIGH | **RESOLVED** — use `FACILITATOR_PK` |
| 3 | ENS funder balance | ✓ OK | 3.9 ETH Sepolia, 2.5 ETH Base Sepolia |
| 4 | SELLER has 0 ETH on both chains | MEDIUM | **Phase 0 step 0b** — fund from X402COMMIT_FUNDER |
| 5 | Workers Assets relative path | LOW | Verified safe in wrangler.toml |
| 6 | `extra.ens` never reaches facilitator (IP-1) | CRITICAL | **Phase 1 Step 1** — must fix |
| 7 | `auth.to` ≠ resolved splitter (IP-3) | CRITICAL | **Phase 1 Step 2** — must fix |
| 8 | `/admin/receipts` auth + field names (IP-4) | HIGH | **Phase 2A steps A1+A2** |
| 9 | `ctx.waitUntil` 30s budget for 5-step onboard | MEDIUM | Demo uses CLI (`just onboard`) not browser form for video reliability |
| 10 | Receipts not tagged by ENS | LOW | Mitigated by single-agent demo + splitter-address filter |
| 11 | KH import timeline | LOW | fallback: shell command hint |
| 12 | Smoke uses `seller9` — reserve for actual demo | MEDIUM | **Phase 1 Step 8** uses `seller-smoke-1` |
