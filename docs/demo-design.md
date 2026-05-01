# Reckon402 Demo Design — ETHGlobal OpenAgents 2026

> **Status:** LOCKED 2026-05-01  
> **Canonical source for demo narrative:** also see `memory/demo_narrative.md`  
> Converged from design session; implementation plan follows.

---

## The one-sentence claim

> "Every x402 settlement writes trust on-chain. That trust changes what you pay next. We closed this loop — in production, on testnets, end-to-end."

Everything in the demo either proves that sentence or is cut.

---

## Site topology

| URL | What it is | Deploy target |
|-----|-----------|---------------|
| `reckon402.com` | Marketing landing page — hero, pitch, live service status dots, links | CF Pages (`reckon402-landing`) |
| `demo.reckon402.com` | **Network monitor** — Agent Roster (all agents) + Payment Feed | CF Pages (`reckon402-demo`) |
| `app.reckon402.com` | **Interactive product** — onboarding form + per-agent dashboard | CF Worker (`onboard-orchestrator`) |
| `agent.reckon402.com` | SellingAgent demo endpoint — serves paid `/research` calls | CF Worker (`reckon402-agent`) |
| `facilitator.reckon402.com` | x402 facilitator — verify/settle/attest | CF Worker (`reckon402-facilitator`) |
| `gateway.reckon402.com` | ENS CCIP-Read + flat-records + signed-write admin | CF Worker (`reckon402-gateway`) |
| `signing.reckon402.com` | AWS KMS EIP-3009 signer for BuyingAgents | AWS API GW + Lambda |

---

## Demo flow (3 minutes, one presenter, three browser tabs)

### Tab 1 — reckon402.com (30 seconds)

> "Reckon402 is the trust and settlement layer for AI agent commerce."

Show hero, click the three live service status dots lighting green (facilitator / gateway / signing wrapper health checks run client-side).

Click **"See the demo →"** — opens `demo.reckon402.com`.

---

### Tab 2 — demo.reckon402.com (30 seconds)

> "This is the network today. Every row here is a real USDC payment on Base Sepolia."

**Agent Roster panel** (portfolio, all agents):
- Reads `totalSupply(IdentityRegistry)` → iterates agentIds
- Shows: agentId, wallet (truncated), rep count, price tier, last seen
- Auto-refreshes every 5s (toggle Pause/Resume button)

**Payment Feed panel**:
- Boots by fetching `/admin/receipts?limit=20` (pre-populated across refreshes)
- Each row: paymentId (truncated), status badge, amount, age, Basescan tx link
- New rows pulse green on arrival

Point at agent #1 — rep count 56, bronze tier, price 0.95 USDC. "This agent has 56 real on-chain attestations. It earned a 5% discount."

---

### Tab 3 — app.reckon402.com (2 minutes)

#### Step A — Onboarding form (~60s)

Form fields (pre-filled for the demo):

| Field | Pre-filled value | Editable |
|-------|-----------------|----------|
| ENS label | `seller9` | yes |
| Full ENS name | `seller9.reckon402-test.eth` (computed) | no |
| SellingAgent EOA | `0xD53f...` | yes |
| HTTPS endpoint | `https://agent.reckon402.com/research` | yes |
| Base amount | `100000` (= 0.10 USDC) | yes |
| Revenue split | `0xD53f... 97% / 0x0A02... 2% / 0x66C2... 1%` | hardcoded, greyed |
| Discount tiers | bronze ≥1 (-5%) / silver ≥3 (-10%) / gold ≥10 (-15%) | hardcoded, greyed |

Click **[Deploy]**.

#### Step B — Progress panel (~60s, 5 steps with real on-chain links)

```
✓ Mint ENS subname          → Etherscan link (Ethereum Sepolia)
✓ Deploy Splitter via factory → Basescan link (Base Sepolia)
✓ Register ERC-8004 agentId  → Basescan link (Base Sepolia)
✓ Set ENS records (bootstrap) → gateway /records link
✓ Seed gateway + transfer ENS ownership → Etherscan link
```

After step 5 completes, auto-navigate to `#/agent/seller9.reckon402-test.eth`.

> "60 seconds. ENS subname on Ethereum. Splitter lockbox on Base. ERC-8004 identity on Base. Twelve ENS text records written, signed, verified. The platform cannot turn this agent's records against it — the SellingAgent owns them."

#### Step C — Agent dashboard

**Header card:**
- ENS name: `seller9.reckon402-test.eth`
- Current price: `0.100 USDC` (from gateway `?backend=erc8004`)
- agentId: `3`
- Splitter: `0x372c...` (clickable Basescan link)
- Endpoint: `https://agent.reckon402.com/research`
- ENS owner: `0xD53f...` (clickable Etherscan link)

**ENS Text Records panel** (collapsible, open by default after onboarding):

| Key | Value | Link |
|-----|-------|------|
| `x402.splitter` | `0x372c...` | Basescan |
| `x402.erc8004.agent_id` | `3` | — |
| `x402.amount` | `100000` | — |
| `x402.endpoint` | `https://agent.reckon402.com/research` | — |
| ... 8 more records | ... | ... |

> "These are the ENS text records. They live on Ethereum Sepolia. Any resolver on any chain can read them."

**Trust tier panel:**
- Count: `0 attestations` — badge: `[no tier]` (gray)
- Tier table with active row highlighted:
  ```
  0+   base (no discount)   0.100 USDC  ← active
  1+   bronze (5% off)      0.095 USDC
  3+   silver (10% off)     0.090 USDC
  10+  gold (15% off)       0.085 USDC
  ```

**Option C terminal pane** (always visible, auto-refreshes 3s):
```
$ curl gateway.reckon402.com/records/seller9.reckon402-test.eth?flat=true&backend=erc8004
{"records": {"x402.amount": "100000", ...}}
```

#### Step D — Trigger 3 paid calls via KeeperHub (~45s)

Switch to KeeperHub tab. Open "Reckon402 ResearchAgent" workflow.

> "I'll trigger this from KeeperHub — an agent orchestration platform — to show this works from any compliant x402 buyer, not just our own tooling."

Click **Run**. KeeperHub executes 3 sequential calls to `agent.reckon402.com/research` via `signing.reckon402.com`.

Switch back to `app.reckon402.com` dashboard. Within 15s:

- Call log fills: 3 rows, each with settlement tx (Basescan) + attestation tx (Basescan)
- Trust count: `0 → 1 → 2 → 3`
- Badge: `[no tier] → [bronze]` at count 1
- Tier table: bronze row highlighted — current price `0.095 USDC`

**Option C terminal pane updates automatically:**
```
$ curl gateway.reckon402.com/records/seller9.reckon402-test.eth?flat=true&backend=erc8004
{"records": {"x402.amount": "95000", ...}}
```

> "Three paid calls. Three attestations written to the ERC-8004 registry on Base Sepolia. The gateway read them back. The price changed. The trust loop is closed — without us touching a single config file."

---

## What the KeeperHub workflow sends (kh-workflow.json)

Each call sets `extra.ens = "seller9.reckon402-test.eth"` in the payment requirements so the facilitator's L4c splitter-resolver resolves the correct per-agent Splitter.

The ENS name is a form parameter on the demo run — before each demo, set `DEMO_SELLER_ENS` to match the freshly onboarded agent.

---

## Re-running the demo (fresh agent each time)

Each demo run creates a unique agent:
1. Change the ENS label in the form (e.g. `seller10`, `seller11`)
2. That's it — every on-chain artifact is fresh: new ENS subname, new Splitter (new address via CREATE2 with different salt), new ERC-8004 agentId, new set of text records
3. Previous agents remain visible in the Agent Roster on `demo.reckon402.com`
4. The dashboard for old agents stays queryable at `#/agent/<ensName>`

**Prerequisite per run:** Ensure the ENS funder wallet has Sepolia ETH. Check before demo rehearsal.

**ENS namespace collision check:** `seller9` may already be registered from a prior run. The onboarding step will fail at step 1 with a clear error. Just increment the number.

---

## Mainnet option (stretch goal)

**Decision rule:** If testnet demo runs flawlessly 3 times in a row by Saturday morning, do the mainnet sprint (estimated 3-4h):
- Redeploy `SplitterFactory` on Base mainnet
- Re-parameterize chain IDs in `splitter-resolver.ts` and worker env vars
- Register `reckon402.eth` (or `reckon402-test.eth`) on ETH mainnet
- Add network toggle to `app.reckon402.com`

If not clean by Saturday morning: stay on testnet. Judges understand testnets. A broken mainnet demo is worse than a clean testnet demo.

---

## Implementation plan (ordered by dependency)

### Phase 1 — Deploy `app.reckon402.com` (today, ~1.5h)

1. Apply `gateway/migrations/0003_l4c_signed_writes.sql` to `reckon402-d1-gateway-dev` (remote)
2. Set `RECKON402_ONBOARDING_EOA` in `gateway/wrangler.toml [vars]`
3. Redeploy gateway (`wrangler deploy --env production`)
4. Set orchestrator wrangler secrets: `ENS_FUNDER_PK`, `RECKON402_DEPLOYER_PK`, `RECKON402_ONBOARDING_PK`, `BASE_SEPOLIA_RPC_PRIMARY`, `ETH_SEPOLIA_RPC_PRIMARY`
5. Set orchestrator wrangler vars: `SPLITTER_FACTORY_ADDRESS`, `RECKON402_ONBOARDING_EOA`, `GATEWAY_BASE_URL`, `FACILITATOR_BASE_URL`
6. `wrangler deploy --env production` on `onboard-orchestrator`
7. Smoke: `just onboard seller9.reckon402-test.eth 0xD53f...`
8. Tag `L4c-onboarding-green`

### Phase 2 — UI additions (~2.5h coding)

A. **demo/index.html** (30 min):
   - Add `/admin/receipts?limit=20` boot-poll to pre-populate payment feed
   - Add Pause/Resume toggle for auto-refresh
   - Agent Roster: add dropdown to filter by agentId or "all"

B. **apps/frontend/dist/** (2h):
   - Onboard form: add BPS split display (hardcoded, visual) + tier table preview
   - Dashboard: fetch `/records/:ensName?flat=true&backend=static` to populate agentId / splitter / owner / endpoint
   - Dashboard: ENS Text Records collapsible panel
   - "Run Test Call" button: open KeeperHub workflow URL instead of `alert()`

C. **recipes/kh-workflow.json** (15 min):
   - Add `extra.ens` to each call node so facilitator does L4c resolution
   - Parameterize `DEMO_SELLER_ENS`

### Phase 3 — Static deploys (today, manual, ~40 min)

- Create CF Pages project `reckon402-landing` → `reckon402.com`
- Create CF Pages project `reckon402-demo` → `demo.reckon402.com`
- Publish `kh-workflow.json` to KeeperHub (follow `tools/deploy/kh-platform-runbook.md`)

### Phase 4 — Rehearsal + submission (tomorrow)

- Full demo run × 2 with fresh agents
- Mainnet go/no-go decision
- Record video
- Fill `docs/submission/draft.md` TODO markers (app URL confirmed, team names)
- Submit

---

## Open design decisions (resolved)

| Decision | Resolution |
|----------|-----------|
| demo.reckon402.com: portfolio or single-agent? | Portfolio (all agents) |
| demo.reckon402.com: polling strategy | Auto-refresh 5s with Pause/Resume toggle |
| Onboard form: BPS splits | Hardcoded display, pre-filled, not editable by user |
| Onboard form: KeeperHub / MCP fields | Dropped — out of scope for demo |
| Per-agent subdomain provisioning | Dropped — ENS name IS the on-chain identity; narrate this |
| "Run Test Call" button | Opens KeeperHub workflow (Option B) |
| KeeperHub call: ENS name threading | `extra.ens` added to kh-workflow.json nodes |
| Dashboard: filter receipts by agent | Dropdown (select agent or show all) |
| Access control on dashboard | None — public dashboard is a feature ("transparent trust") |
| Mainnet | Stretch goal, go/no-go Saturday morning |
