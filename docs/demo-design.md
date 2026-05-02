# Reckon402 Demo Design — ETHGlobal OpenAgents 2026

> **Status:** LOCKED 2026-05-02 (reconciled with `docs/canonical-narrative.md` A0 lock)
> **Canonical source for demo narrative:** `docs/canonical-narrative.md` (locked)
> Converged from design session; implementation plan follows.

---

## The one-sentence claim

> "Every x402 settlement writes trust on-chain. A portion of every payment flows into the SellingAgent's per-agent on-chain Escrow; the Escrow's release schedule is parameterized by the same on-chain trust signal. Funds release as reputation grows, NFT-bound to the agent's IdentityRegistry token."

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
- Shows: agentId, wallet (truncated), `attestationCount`, current Escrow tier (T0–T7), `currentlyHeld`, `withdrawableNow`, last seen
- Auto-refreshes every 5s (toggle Pause/Resume button)

**Payment Feed panel**:
- Boots by fetching `/admin/receipts?limit=20` (pre-populated across refreshes)
- Each row: paymentId (truncated), status badge, amount, age, Basescan tx link
- New rows pulse green on arrival

Point at agent #1 — `attestationCount=56` → tier T4 → `releasedBps=5000` (50% of deposited Escrow released). "This agent has 56 real on-chain settlement attestations. Half the Escrow buffer has unlocked; the other half stays held against future claims until the count walks T4 → T5."

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
| Base amount | `10000` (= 0.01 USDC, canonical test amount) | yes |
| Revenue split | `0xD53f... 87% / 0x0A02... 3% / Escrow 10%` | hardcoded, greyed |
| Tier strategy | `LinearMonotonicTierStrategy v1` — thresholds [0,1,3,10,30,100,300,1000], release BPS [0,500,1500,3000,5000,7000,8500,10000] | hardcoded, greyed |

Click **[Deploy]**.

#### Step B — Progress panel (~75s, 6 steps with real on-chain links)

```
✓ Mint ENS subname                    → Etherscan link (Ethereum Sepolia)
✓ Register ERC-8004 agentId           → Basescan link (Base Sepolia)
✓ Deploy per-agent Escrow (CREATE2)   → Basescan link (Base Sepolia)
✓ Deploy Splitter via factory         → Basescan link (Base Sepolia)
✓ Set ENS records (bootstrap)         → gateway /records link
✓ Seed gateway + transfer ENS ownership → Etherscan link
```

After step 6 completes, auto-navigate to `#/agent/seller9.reckon402-test.eth`.

> "About a minute. ENS subname on Ethereum. ERC-8004 identity on Base. A per-agent Escrow contract at a deterministic CREATE2 address. A Splitter routing 87 percent to the seller, 3 percent to the facilitator, 10 percent into the agent's own Escrow on every settlement. Twelve ENS text records written, signed, verified. The platform provisioned all of this — but never owned it. The ENS name and agentId transferred to the seller's wallet at the end of onboarding. The platform cannot turn this agent's records against it."

**Ownership model (why this is true):**
- ENS subname: platform holds it only during steps 1–5 (bootstrap window), step 6 transfers to seller EOA
- ERC-8004 agentId: seller's key calls `register()` directly → mints to seller as msg.sender, no transfer step
- Per-agent Escrow: CREATE2-deployed at a deterministic address bound to the seller's agentId; tier strategy is `LinearMonotonicTierStrategy v1` (immutable once set)
- Splitter: CREATE2-deployed via factory with seller EOA as primary recipient and the per-agent Escrow as the 10% recipient

#### Step C — Agent dashboard

**Header card:**
- ENS name: `seller9.reckon402-test.eth`
- Base price: `0.010 USDC` (from gateway `?backend=erc8004` → `x402.amount`)
- agentId: `3`
- Splitter: `0x372c...` (87% seller / 3% facilitator-fee / 10% Escrow) — clickable Basescan link
- Escrow: `0x...` (per-agent, NFT-bound) — clickable Basescan link
- Endpoint: `https://agent.reckon402.com/research`
- ENS owner: `0xD53f...` (clickable Etherscan link)

**ENS Text Records panel** (collapsible, open by default after onboarding):

| Key | Value | Link |
|-----|-------|------|
| `x402.splitter` | `0x372c...` | Basescan |
| `x402.erc8004.agent_id` | `3` | — |
| `x402.amount` | `10000` | — |
| `x402.endpoint` | `https://agent.reckon402.com/research` | — |
| ... 8 more records | ... | ... |

> "These are the ENS text records. They live on Ethereum Sepolia. Any resolver on any chain can read them."

**Escrow trust panel** (the hero panel — read live from `Escrow.getStats()` via one `eth_call` to Base Sepolia, refreshed every 3s):

| Counter | Value (post-onboarding, pre-settlement) |
|---------|------------------------------------------|
| `attestationCount` | `0` (T0 tier — no on-chain history yet) |
| `releasedBps` | `0` (no fraction released) |
| `totalDeposited` | `0` |
| `currentlyHeld` | `0` |
| `withdrawableNow` | `0` |
| `totalWithdrawn` | `0` |

Tier table with active row highlighted (the active row is the floor of the current `attestationCount`):

```
T0    0+   releasedBps=0      ← active
T1    1+   releasedBps=500    (5% of deposited released)
T2    3+   releasedBps=1500   (15% released)
T3   10+   releasedBps=3000   (30% released)
T4   30+   releasedBps=5000   (50% released)
... up to T7 (1000+ attestations → 100% released)
```

**Option C terminal pane** (always visible, auto-refreshes 3s):
```
$ cast call $ESCROW "getStats()(uint256,uint256,uint256,uint256,uint256,uint256,uint256)" --rpc-url https://sepolia.base.org
0  0  0  0  0  0  0
```

#### Step D — Trigger 3 paid calls via KeeperHub, then Claim (~45s)

Switch to KeeperHub tab. Open "Reckon402 ResearchAgent" workflow.

> "I'll trigger this from KeeperHub — an agent orchestration platform — to show this works from any compliant x402 buyer, not just our own tooling."

Click **Run**. KeeperHub executes 3 sequential calls to `agent.reckon402.com/research` via `signing.reckon402.com`. Each call settles 0.01 USDC on-chain; the Splitter routes 1000 atomic (10%) into the per-agent Escrow on every settlement; the facilitator writes one ERC-8004 `NewFeedback` event per settlement.

Switch back to `app.reckon402.com` dashboard. Within 15s:

- Call log fills: 3 rows, each with settlement tx (Basescan) + attestation tx (Basescan)
- Escrow trust panel updates live:

| Counter | After 3 settlements |
|---------|---------------------|
| `attestationCount` | `3` (T2 tier crossed) |
| `releasedBps` | `1500` (15%) |
| `totalDeposited` | `3000` atomic (= 0.003 USDC, 10% of 0.030 USDC settled) |
| `currentlyHeld` | `3000` (none withdrawn yet) |
| `withdrawableNow` | `450` (= 3000 × 1500 / 10000) |

- Tier table: T2 row highlighted (active tier walked T0 → T1 at count 1, T1 → T2 at count 3)

**Option C terminal pane updates automatically:**
```
$ cast call $ESCROW "getStats()(uint256,uint256,uint256,uint256,uint256,uint256,uint256)" --rpc-url https://sepolia.base.org
3000  3000  450  0  450  3  1500
```

Click **Connect Wallet** → import the seller PK in MetaMask. The connected address must match `IdentityRegistry.ownerOf(agentId)` for the Claim button to activate. Click **Claim All** → MetaMask signs `Escrow.withdrawAll()` (calldata `0x853828b6`, no args) → tx lands on Base Sepolia → 450 atomic transfers from Escrow to the seller.

After the claim:

| Counter | After 3 settlements + claim |
|---------|------------------------------|
| `currentlyHeld` | `2550` (= 3000 − 450) |
| `totalWithdrawn` | `450` |
| `withdrawableNow` | `0` (all of the released slice is now withdrawn) |
| `attestationCount` | `3` (unchanged) |
| `releasedBps` | `1500` (unchanged) |

The remaining 2550 atomic stays locked in the Escrow until the next attestation pushes the agent into T3 (10 attestations → 30% released → an additional 450 atomic unlocks).

> "Three settlements. Three on-chain attestations. The Escrow held back 90% of the buffer at T0; at T2 it released 15% of the deposited slice; the seller's NFT-bound owner claimed it on-chain in one transaction. The trust loop is closed — settlements feed reputation, reputation parameterizes Escrow release, the seller's NFT controls withdrawal."

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
