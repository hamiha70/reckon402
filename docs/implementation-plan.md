# Reckon402 — Implementation Plan: Demo Completion Sprint
# ETHGlobal OpenAgents 2026 — 2 days remaining (2026-05-01 → 2026-05-03)

> **Purpose of this document:** Hand to Opus 4.7 for adversarial review before
> implementation begins. Challenge: hidden dependencies, mis-ordered steps, scope
> that will break the deploy sequence or the demo under time pressure.
>
> **Revert point:** tag `design-locked-2026-05-01` (committed, pushed).
> **Design doc:** `docs/demo-design.md` (full demo script, voiceover, site topology).
> **Existing deploy runbook:** `tools/deploy/deploy-l4c-onboarding.md` (Steps 0-11,
> very detailed — this plan references it rather than duplicating).

---

## Current state (what is live RIGHT NOW)

| Service | URL | Status |
|---------|-----|--------|
| Facilitator | `facilitator.reckon402.com` | LIVE, version `dc14eb8e` |
| Gateway | `gateway.reckon402.com` | LIVE, version `3d9c120f` |
| SellingAgent endpoint | `agent.reckon402.com` | LIVE |
| EIP-3009 signer | `signing.reckon402.com` | LIVE |
| Onboarding app | `app.reckon402.com` | **NOT DEPLOYED** |
| Landing page | `reckon402.com` | **NOT DEPLOYED** |
| Network monitor | `demo.reckon402.com` | **NOT DEPLOYED** |

All unit tests: 97/97 facilitator, 85/85 gateway, 24/24 onboard tools, 13/13
orchestrator. All passing on `main` at tag `L4c-factory-green`.

Gateway admin routes (`/admin/records`, `/admin/bootstrap`,
`/admin/bootstrap/gateway-seed`) ARE in the live gateway code BUT:
- D1 migration `0003_l4c_signed_writes.sql` has NOT been applied
- `RECKON402_ONBOARDING_EOA` is empty string in gateway wrangler.toml
- So all admin routes currently return 503 `onboarding_eoa_not_configured`

SplitterFactory deployed: `0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7` (Base Sepolia, block 40932143).

---

## What needs to happen before the video recording

### Non-negotiables (demo breaks without these)
1. `app.reckon402.com` must serve the onboarding form and dashboard
2. A live onboarding must succeed end-to-end (`just onboard seller9...`)
3. "Run Test Call" triggers a real paid call visible in the dashboard
4. Option C terminal pane shows `x402.amount` changing after attestations

### High-value additions (demo is significantly weaker without these)
5. Dashboard shows agentId / splitter / ENS owner (currently `—`)
6. ENS Text Records panel on dashboard (shows ENSIP-25 proof)
7. `demo.reckon402.com` deployed (network portfolio view)
8. `reckon402.com` deployed (landing page)

### Nice-to-have (cut if time-pressured)
9. BPS split display on onboard form
10. KeeperHub workflow published (alternative to browser-native paid call)
11. "Download KH workflow" button on dashboard

---

## Phase 1 — Deploy `app.reckon402.com` (~1.5h, sequential, Claude runs)

**Dependency chain is strict — each step gates the next.**

```
Step 1: Apply gateway/migrations/0003_l4c_signed_writes.sql to reckon402-d1-gateway-dev
        → verify: SELECT name FROM sqlite_master WHERE type='table' returns 3 rows

Step 2: Derive RECKON402_ONBOARDING_EOA from RECKON402_ONBOARDING_PK
        → edit gateway/wrangler.toml [vars] + [env.production.vars] + [env.staging.vars]
        → commit

Step 3: wrangler deploy --env production (gateway)
        → verify: curl admin/records returns 400 (not 404)
        → verify: just fullflow-l4b still exits 0 (L4b regression)

Step 4: wrangler secret put × 5 on onboard-orchestrator (Infisical-piped)
        → ENS_FUNDER_PK, RECKON402_DEPLOYER_PK, RECKON402_ONBOARDING_PK,
          ETH_SEPOLIA_RPC_PRIMARY, BASE_SEPOLIA_RPC_PRIMARY

Step 5: Edit orchestrator wrangler.toml — fill SPLITTER_FACTORY_ADDRESS + RECKON402_ONBOARDING_EOA
        → commit

Step 6: wrangler deploy --env production (onboard-orchestrator)
        → verify: curl app.reckon402.com/healthz returns {"ok":true}
        → verify: curl app.reckon402.com/ returns 200 (index.html)

Step 7: just onboard seller9.reckon402-test.eth <SELLER_EOA>
        → verify: 5 steps complete, gateway serves x402.splitter + x402.erc8004.agent_id
        → verify: ENS subnode owner = SELLER_EOA (not funder)

Step 8: just fullflow-l4c-onboard (automated smoke)
        → must exit 0
        → capture: smoke ENS name, post-attestation x402.amount value

Step 9: tag L4c-onboarding-green + push
```

**Known risks in Phase 1:**
- `RECKON402_ONBOARDING_PK` may not be in Infisical yet (new key needed for 08B, not used in L4b). If missing, Phase 1 blocks completely. Must check Infisical secrets inventory first.
- ENS funder wallet balance: each onboarding costs ~0.003 ETH Sepolia. Need ≥0.01 ETH for demo + rehearsal + retries.
- Workers Assets `[assets]` binding requires `directory = "../../apps/frontend/dist"` — this is a relative path from the worker's directory. If the build is run from a different CWD, the path may not resolve. The `dist/` files are committed so no build step needed.
- `RECKON402_DEPLOYER_PK` is the same key as the 08A KMS deployer conceptually, but the orchestrator needs a plain hex PK, not KMS. Confirm `RECKON402_DEPLOYER_PK` exists as a plain PK in Infisical (NOT the KMS alias used by `deploy-splitter-factory.mjs`).

---

## Phase 2 — UI additions (~2.5h coding, can parallelize after Phase 1 Step 6)

These are code changes that need to be deployed after Phase 1. They can be
coded in parallel with Phase 1 Steps 7-9 or in a second pass.

### 2A — `apps/frontend/dist/app.js` additions (~90 min, one agent)

**A1. Dashboard: populate agentId / splitter / owner / endpoint from records (15 min)**
- Replace placeholder `—` values in `renderDashboardHeader()`
- Source: `GET gateway.reckon402.com/records/:ensName?flat=true&backend=static`
- Fields: `x402.erc8004.agent_id` → `#dash-agent-id`, `x402.splitter` → `#dash-splitter`,
  `x402.endpoint` → `#dash-endpoint`
- ENS owner: separate call to `/records/:ensName?flat=true&backend=static` doesn't
  include the ENS owner address — need ENS Registry read OR a gateway endpoint.
  **Fallback: display splitter + agentId + endpoint, skip owner for now.**

**A2. Dashboard: ENS Text Records collapsible panel (25 min)**
- After dashboard header card, add a `<details>` element (no JS needed for collapse)
- Fetch `GET /records/:ensName?flat=true&backend=static`
- Render all keys in a 2-column table with clickable links for `0x...` values
- Etherscan for Ethereum Sepolia addresses, Basescan for Base Sepolia addresses

**A3. "Run Test Call" button: open KeeperHub workflow OR browser paid call (30 min)**

Option B-simple (recommended): Change the `alert()` to open the KeeperHub workflow URL
in a new tab. Pre-condition: KH workflow is published (Phase 3C).

Option B-browser (richer, riskier): Make a real browser-side paid call using
`signing.reckon402.com` + `facilitator.reckon402.com`. Requires:
- POST to signing.reckon402.com/sign with the EIP-3009 payload
- POST to facilitator.reckon402.com/x402/settle with the payment header
- No CORS issues (signing.reckon402.com has `*` CORS, facilitator too)
- BUT: browser needs SIGNING_WRAPPER_API_KEY — this is a secret. Cannot hardcode.
  **This blocks Option B-browser unless we either make the key public (bad)
  or add a proxy endpoint on the orchestrator (adds scope).**

**Recommended: Option B-simple first** (open KH URL, 3 lines), add Option B-browser
as a stretch after Phase 3 (KH publish). If KH isn't published in time, button
stays as the `alert()` shell-command hint — still functional for the demo.

**A4. Dashboard: filter receipts dropdown (20 min)**
- Add `<select>` above the calls table: "All agents" + each known ENS name
- On change: re-filter the `receipts` array in memory (no new fetch)
- Seed: populate dropdown from the current ENS name + "All"
- **Note:** receipts table does NOT store ENS name per payment (INSERT doesn't
  include it). So "filter by agent" means filtering by `auth_to` (the splitter
  address), which IS stored. Map `splitter → ensName` from the gateway records
  fetch. This works for the single-agent demo case; with multiple agents it
  requires a splitter→name lookup per receipt.
  **Simplification: for the demo, the dropdown just shows the active ENS and
  "All" — no per-receipt filtering needed since there's one agent per dashboard.**

### 2B — `demo/index.html` additions (~45 min, one agent)

**B1. Boot-poll `/admin/receipts` to pre-populate payment feed (15 min)**
- On page load: `fetch('https://facilitator.reckon402.com/admin/receipts?limit=20')`
- Add returned `payment_id` values to `knownPaymentIds` Set
- Payment feed then works across page refreshes (not just in-session)

**B2. Pause/Resume toggle for auto-refresh (10 min)**
- Add a button that clears/restores the `setInterval` timers
- Default: running. Pause before voiceover sections.

**B3. Agent Roster: dropdown to filter by agentId or "All" (20 min)**
- The roster already iterates all agents from `totalSupply`
- Add a `<select>` above the roster table: "All agents" + `#1`, `#2`, etc.
- On change: filter `rosterState` render to show only selected agentId

### 2C — `recipes/kh-workflow.json` update (15 min, simple edit)

- Add `"extra": {"ens": "${DEMO_SELLER_ENS}"}` to each call node's config
- The facilitator's L4c path reads `paymentRequirements.extra.ens` to run
  splitter resolution. Without this, the KH call uses the old L3 SPLITTER_ADDRESS
  env var and bypasses the ENS→Splitter resolution entirely.
- **This is required for the KH demo to show the L4c trust loop.**
- Make `DEMO_SELLER_ENS` a workflow variable (KH supports `${VAR}` interpolation).

---

## Phase 3 — Static deployments (manual, ~40 min, user runs)

These require a Cloudflare API token with `Pages:Edit` scope, which the Infisical
token lacks. Must be done manually by the user in the CF dashboard.

**3A — `reckon402.com` (CF Pages, `reckon402-landing`)**
- Follow `landing/DEPLOY.md`
- Source: `landing/index.html` (static, no build)
- Custom domain: `reckon402.com`

**3B — `demo.reckon402.com` (CF Pages, `reckon402-demo`)**
- Follow `demo/DEPLOY.md`
- Source: `demo/index.html` (static, no build)
- Custom domain: `demo.reckon402.com`
- **Deploy AFTER Phase 2B** so the boot-poll and pause toggle are in the file

**3C — KeeperHub workflow publish**
- Follow `tools/deploy/kh-platform-runbook.md`
- Import `recipes/kh-workflow.json` (AFTER Phase 2C edits)
- Set `SIGNING_WRAPPER_API_KEY` as a KH secret
- Capture workflow URL → paste into AGENTS.md KH section

---

## Phase 4 — Demo rehearsal + submission (tomorrow, 2026-05-02)

```
Morning:
  Full demo run × 2 with fresh agents (seller10, seller11)
  → Each run proves: onboard form → 5 steps → dashboard → 3 KH calls → badge + price change
  → Check: Option C terminal pane updates correctly
  → Check: demo.reckon402.com shows new agents in roster
  → Check: reckon402.com landing page looks correct

Mainnet go/no-go decision (see decision rule in demo-design.md):
  → Only proceed if testnet ran cleanly twice with no manual intervention

Afternoon:
  Record demo video (target: under 3 minutes)
  Fill docs/submission/draft.md TODO markers:
    - [TODO] frontend URL → https://app.reckon402.com (confirmed after Phase 1)
    - [TODO] team names/handles
  Final submission
```

---

## Dependency graph (critical path)

```
Phase 1 Steps 1-3 (gateway migration + ONBOARDING_EOA + deploy)
    ↓
Phase 1 Steps 4-6 (orchestrator secrets + vars + deploy)
    ↓
Phase 1 Steps 7-8 (live onboard smoke)
    ↓
Phase 1 Step 9 (tag L4c-onboarding-green)
    ↓
Phase 2 coding (A1-A4, B1-B3, C) ← can run in parallel subagents
    ↓
Re-deploy orchestrator (Phase 2 frontend changes) + re-deploy demo page (Phase 3B)
    ↓
Phase 4 rehearsal
```

Phase 3A (`reckon402.com`) is independent — can be done any time.
Phase 3C (KH publish) depends on Phase 2C (`extra.ens` fix).

---

## Parallel agent strategy for Phase 2

Phase 2 touches three independent files. Safe to run as concurrent agents:

| Agent | Files | Duration |
|-------|-------|----------|
| Agent 1 | `apps/frontend/dist/app.js` + `apps/frontend/dist/index.html` | ~90 min |
| Agent 2 | `demo/index.html` | ~45 min |
| Agent 3 | `recipes/kh-workflow.json` | ~15 min |

Agent 1 and Agent 2 don't touch the same files. Agent 3 is trivial.
After all three complete: single commit, re-deploy orchestrator and demo page.

---

## Key risks to challenge (bring to Opus)

1. **`RECKON402_ONBOARDING_PK` in Infisical?** If this key doesn't exist yet,
   Phase 1 is blocked. Need to confirm before starting.

2. **`RECKON402_DEPLOYER_PK` = plain hex PK, not KMS alias.** The onboard
   orchestrator calls `deploySplitter` and `registerAgentId` using a plain
   `privateKeyToAccount(env.RECKON402_DEPLOYER_PK)`. The 08A SplitterFactory
   deploy used KMS. Are these the same or different keys? If the same EOA
   needs to be used but only exists as a KMS key, the orchestrator as written
   CANNOT use it — `tools/onboard/src/steps/deploy-splitter.ts` uses
   `privateKeyToAccount`, not the KMS client.

3. **ENS funder wallet balance.** Easy to check, catastrophic to miss. Each
   onboarding burns ~0.003 ETH Sepolia. Need ≥0.015 ETH for demo + rehearsals.

4. **Workers Assets relative path.** `directory = "../../apps/frontend/dist"`
   is relative to the worker's `wrangler.toml`. Does wrangler resolve this
   correctly when run from repo root vs. from the worker directory?

5. **`extra.ens` propagation to facilitator.** The KH workflow sends
   `extra.ens` in the payment requirements. Does `agent.reckon402.com`
   actually forward `extra` fields in the x402 request to the facilitator?
   If not, the facilitator never sees the ENS name and L4c resolution fails.
   This is the single highest-risk integration point for the KH demo path.

6. **Receipts not tagged by ENS name.** The facilitator `receipts` D1 table
   doesn't store which merchant/ENS the payment was for. The dashboard
   `fetchRecentReceipts()` fetches all receipts. With multiple agents onboarded
   (demo runs), the call log on `seller9`'s dashboard will show `seller10`'s
   receipts too. Mitigation: single-agent demo, or filter by `auth_to` =
   splitter address (requires mapping splitter → ensName in the frontend).

7. **KeeperHub import timeline.** If the KH platform runbook requires a
   manual app.keeperhub.com step that takes >30 min (account setup, approval),
   Phase 3C could block Phase 4. Fallback: "Run Test Call" shows a shell
   command or opens a raw curl. Still functional for demo.

8. **Orchestrator `ctx.waitUntil` budget.** The onboarding runs in
   `ctx.waitUntil` — Cloudflare gives 30s post-response CPU time. The 5-step
   onboarding involves 3 chain txs + 2 gateway calls. If any tx takes >10s
   to confirm (Base Sepolia can be slow), the worker may timeout and the
   progress store shows the job as abandoned (no `failed` state, just stops).
   The frontend polls `/onboard/:id/status` and would just hang. Mitigation:
   use `just onboard` CLI for the demo rather than the browser form — CLI
   has no 30s budget. For the video, this matters: if we show the browser form,
   we need the 5 steps to complete within 30s of the 202 response.

---

## Open decisions (need Opus challenge)

1. **`RECKON402_DEPLOYER_PK` — same as KMS deployer or new plain-PK key?**
   Current code path requires plain hex. The 08A factory deploy used KMS.
   If we want the same EOA for both, we need to either: (a) extract the plain
   PK from KMS (not possible — KMS is non-extractable by design), or (b) use
   a different deployer EOA for onboarding (fine — the factory just needs to
   be called from any funded EOA, not specifically the original deployer).

2. **Browser form vs. CLI for demo.** Given the `ctx.waitUntil` 30s risk,
   should the demo video show the browser form or drive it via CLI with the
   dashboard open separately? Browser form is more impressive visually.
   CLI is more reliable. Middle path: browser form for the video (impressive),
   fall back to CLI for the live demo if timing is risky.
