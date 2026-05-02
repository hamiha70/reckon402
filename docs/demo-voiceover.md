# Reckon402 Demo Voiceover Script

> **Status:** drafted 2026-05-02 H-9 sprint, mirrors the L4d Escrow narrative
> from `docs/canonical-narrative.md`. Recorded against the live `seller19`
> run captured in
> `tools/integration-tests/results-full-flow-l4b-2026-05-02T20-24-05Z.md`.
>
> **Format.** Five acts, ~3:30 total. Each act lists the voiceover text and
> the visual cue the operator should be on-screen for that beat. Voiceovers
> are recorded separately and synced to the screen capture in post — the
> operator does not have to deliver them live.

---

## Act 0 — Title card (5s)

**Visual.** Static frame: tagline "Agent commerce with memory."

**Voiceover.**
> Reckon402. Agent commerce with memory.

---

## Act 1 — Landing page (25s)

**Visual.**
1. Browser tab on `https://reckon402.com`.
2. Scroll once through the hero + "what's built" section.
3. Hover the architecture flow box (settle → distribute → attest → reputation).

**Voiceover.**
> The pieces of agent commerce already exist. x402 negotiates payment in
> HTTP. ENS gives agents names. ERC-8004 tracks identity and reputation
> on-chain. USDC settles. None of them close the loop. Reckon402 closes
> the first loop: every confirmed x402 settlement writes an ERC-8004
> reputation attestation, and every ENS lookup reads it back. For this
> hackathon, the trust signal drives a per-agent on-chain Escrow that
> holds funds against future claims and releases as reputation grows.

---

## Act 2 — Onboarding (50s)

### Beat 2A — The form (10s)

**Visual.**
1. Browser tab on `https://app.reckon402.com`.
2. Pause on the empty onboarding form, scroll once across the field layout
   (ENS label, EOA, endpoint, base price, on-chain Escrow toggle ON).

**Voiceover.**
> One form. ENS subname, the agent's wallet, the HTTPS endpoint, the base
> price per call. The Escrow option is on by default — that's the new piece.

### Beat 2B — Why we run it from the CLI (10s)

**Visual.**
1. Switch to terminal.
2. Type but don't yet run:
   `just onboard-l4d seller19.reckon402-test.eth 0xD53ffac42496d73B3Faf946786688a8454F57b1f`

**Voiceover.**
> The form executes the same six-step flow, but Cloudflare Workers cap
> background work at thirty seconds and ours runs longer than that. So for
> the demo we drive it from the CLI — same code, no Worker timeout.

### Beat 2C — Run + commentary (30s)

**Visual.**
1. Hit enter on the `just onboard-l4d` command.
2. Let the six step lines stream past in the terminal:
   ```
   ✓ Mint ENS subname            seller19.reckon402-test.eth
   ✓ Register ERC-8004 agentId   id=5421
   ✓ Deploy per-agent Escrow     0x8E7cd7551BF5cb13D2e527cFC8eC2Ad8AB6BB9C5
   ✓ Deploy Splitter via factory 0x96A8B60c4C5511FA6381c5460a892db519e5dE56
   ✓ Set ENS records             12 records signed + cached
   ✓ Transfer ENS ownership      → 0xD53f...7b1f
   ```
3. When the script prints the dashboard URL, hover it but don't click yet.

**Voiceover.**
> Six steps. ENS subname on Ethereum Sepolia. ERC-8004 identity on Base
> Sepolia. A per-agent Escrow contract at a deterministic CREATE2 address.
> A Splitter routing 87 percent to the seller, 3 percent to the
> facilitator, 10 percent into the agent's own Escrow on every settlement.
> Twelve ENS text records signed and served via CCIP-Read. The platform
> provisioned all of this. It never owned it — the ENS name and agentId
> transferred to the seller's wallet in the last step.

---

## Act 3 — The dashboard (30s)

**Visual.**
1. Open `https://app.reckon402.com/#/agent/seller19.reckon402-test.eth`.
2. Slow scroll top to bottom, pausing ~2 seconds on each panel:
   - Header (price 0.10 USDC, agentId 5421, Splitter, Escrow, owner)
   - Splitter recipients (87% / 3% / 10%)
   - ENS Text Records (collapsed bar — open it for ~3s to show 12 records)
   - Risk buffer (Escrow) — empty, attestations = 0, T0 active
   - Recent paid calls — "no calls yet"

**Voiceover.**
> This is the agent's dashboard. Per-agent Splitter, per-agent Escrow,
> twelve signed ENS text records served from a CCIP-Read gateway. Right
> now the agent has zero attestations — tier T0 — so the Escrow would
> hold one hundred percent of the buffer if any payment landed. Nothing
> has paid this agent yet. Let's change that.

---

## Act 4 — A paid call (60s)

### Beat 4A — Trigger from the buyer (15s)

**Visual.**
1. Switch to terminal (keep dashboard tab open in background for next beat).
2. Type and run:
   `SELLER_NAME=seller19.reckon402-test.eth just fullflow-l4b`
3. Let the steps stream:
   ```
   [1/6] GET /research WITHOUT payment header -> expect 402
   [2/6] Sign PaymentPayload via @reckon402/buyer-sdk
   [3/6] GET /research WITH payment -> expect 200
   ```
4. Pause briefly on `HTTP 200 tx=0xa46f...af6c state=CONFIRMED`.

**Voiceover.**
> An x402 buyer hits the agent. First call comes back 402 Payment
> Required with the price and the destination Splitter. The buyer SDK
> signs an EIP-3009 transferWithAuthorization for one tenth of a USDC,
> retries with the signed payment header, and the facilitator settles
> on Base Sepolia.

### Beat 4B — What landed on-chain (35s)

**Visual.**
1. Switch to dashboard tab.
2. Wait ~5 seconds for the next 3-second poll cycle.
3. The "Recent paid calls" table now has one row with three transaction
   hashes: settle, distribute, attest.
4. Click the **settle tx** (blue, leftmost). New tab on
   `sepolia.basescan.org/tx/0xa46f...af6c`.
5. Scroll to the "ERC-20 Tokens Transferred" section so the three lines
   are visible: 0.087 → seller, 0.003 → facilitator, 0.010 → Splitter.
6. Switch back to the dashboard tab.
7. Click the **distribute tx** (amber, middle column). New tab on
   `sepolia.basescan.org/tx/0x1f2f...5299`.
8. Scroll to "ERC-20 Tokens Transferred" so the Splitter → Escrow
   transfer line is visible (0.010 USDC).
9. Switch back to the dashboard tab.
10. Click the **attest tx** (green, rightmost). New tab on
    `sepolia.basescan.org/tx/0x1d27...b4bc`.
11. Briefly highlight the `NewFeedback` event in the logs.

**Voiceover.**
> Three transactions land. The first is the USDC transfer — the buyer
> pays the Splitter directly with one signed authorization, no approval
> step, no intermediate custody. The second is the Splitter contract
> distributing the funds: 87 percent to the seller's wallet, 3 percent
> to the facilitator as fee, 10 percent into the agent's own Escrow
> contract. The third is the facilitator writing an ERC-8004 attestation
> for this settlement to the on-chain reputation registry. One paid call.
> Three contract interactions. The reputation count just walked from
> zero to one.

### Beat 4C — Dashboard updates live (10s)

**Visual.**
1. Switch back to the dashboard tab.
2. Pause on the Risk Buffer panel — attestation count now reads `1`,
   T1 row is highlighted, `Total deposited 0.0100 USDC`,
   `Currently held 0.0095 USDC`, `Released to seller 5%`,
   `Withdrawable now 0.000500 USDC`.

**Voiceover.**
> The dashboard reads it back. One attestation. Tier walks from T0 to
> T1. Five percent of the deposited buffer is now released and claimable
> by the agent's owner. Ninety-five percent stays held until the next
> attestation walks the agent into T2.

---

## Act 5 — Claim (35s)

### Beat 5A — Connect wallet (15s)

**Visual.**
1. Click the **Connect Wallet** button (top right of dashboard).
2. MetaMask popup, select the seller account
   (`0xD53ffac42496d73B3Faf946786688a8454F57b1f` — pre-imported).
3. Approve.
4. Pause on the dashboard so the viewer sees:
   - Wallet status row appears: `connected: 0xD53f...7b1f`
   - Owner flag turns green: `✓ owner of agent NFT — can claim`
   - Claim row label changes from "Connect wallet to claim" to
     `Withdraw 0.000500 USDC to 0xD53f...7b1f`, button enabled, label `Claim All`.

**Voiceover.**
> The seller connects their wallet. The dashboard runs an `eth_call` to
> IdentityRegistry.ownerOf, sees the connected address holds the agent's
> NFT, and unlocks the Claim button. Withdraw is NFT-bound — only the
> account that owns the agent's IdentityRegistry token can authorize it.

### Beat 5B — Claim (20s)

**Visual.**
1. Click **Claim All**.
2. MetaMask popup → Confirm. Show the calldata field briefly: `0x853828b6`
   (the `withdrawAll()` selector, no args).
3. After signing, the dashboard's claim status line shows:
   `submitted tx 0x...` with a Basescan link.
4. Click the link, new Basescan tab on the withdraw transaction.
5. Scroll to "ERC-20 Tokens Transferred" so the Escrow → seller line is
   visible (0.000500 USDC).
6. Switch back to dashboard tab.
7. Wait one poll cycle (~3s).
8. Risk Buffer panel updates: `Currently held 0.0095 USDC` (unchanged
   for now since only the released slice was withdrawn),
   `Withdrawable now 0.000000 USDC`,
   `Total withdrawn 0.000500 USDC`.

**Voiceover.**
> One transaction, no calldata arguments — `withdrawAll`. The Escrow
> contract reads its own `releasedBps` value, computes the unlocked
> amount, transfers it to the NFT owner, and increments the withdrawn
> counter. The remaining ninety-five percent stays locked until the
> agent's reputation count walks into the next tier. The trust loop is
> closed: settlements feed reputation, reputation parameterizes Escrow
> release, and the seller's NFT controls withdrawal.

---

## Act 6 — Outro (10s)

**Visual.** Static frame: `reckon402.com`, GitHub URL, and the tagline
"Agent commerce with memory."

**Voiceover.**
> Reckon402. Open source. Live on Base Sepolia. The repo, the contracts,
> the workflow recipe — all linked from reckon402.com.

---

## Recording checklist

Before pressing record:

1. **Browser windows.** Three tabs prepared: `reckon402.com`,
   `app.reckon402.com/#/agent/seller19.reckon402-test.eth`, blank tab for
   Basescan jumps.
2. **Terminal.** One window, `just` and `infisical` ready, working dir at
   repo root, font size bumped 1–2 steps for readability.
3. **MetaMask.** Seller account
   (`0xD53ffac42496d73B3Faf946786688a8454F57b1f`) imported and visible in
   the account list. `BASE_SEPOLIA_RPC_PRIMARY` configured on Base Sepolia
   (chainId 84532). Account funded with at least 0.005 ETH for gas.
4. **Fresh agent.** Run a NEW `just onboard-l4d sellerN.reckon402-test.eth …`
   on the morning of the recording so the dashboard starts at zero
   attestations / Total deposited 0. The script in this doc references
   `seller19` — substitute the fresh label everywhere.
5. **Re-point agent worker.** Edit `workers/agent/wrangler.toml` to point
   `SELLER_ENS`, `SPLITTER_ADDRESS`, `AMOUNT` at the fresh agent and
   redeploy: `just deploy-agent`.
6. **Confirm `just fullflow-l4b` is green** with `SELLER_NAME=<fresh>`
   before pressing record. If it fails, do not record — debug first.
7. **Tail.** Optionally keep `just tail-facilitator` running in a
   background terminal so any silent failure shows up.

---

## Common substitutions

The script references the seller19 run literally. For a fresh recording:

| Reference in script | Replace with |
|---------------------|--------------|
| `seller19.reckon402-test.eth` | the new ENS label |
| `agentId 5421` | the new agentId from onboarding step 2 |
| `0x96A8B60c…dE56` (Splitter) | new Splitter address from step 4 |
| `0x8E7cd755…B9C5` (Escrow) | new Escrow address from step 3 |
| `0xa46f…af6c` (settle tx) | new settle tx from `fullflow-l4b` |
| `0x1f2f…5299` (distribute tx) | parsed from receipt `reconcileNotes` |
| `0x1d27…b4bc` (attest tx) | new `td_erc8004_tx` from receipt |

The price (`0.10 USDC`), the splits (87/3/10), the tier curve, and the
seller EOA stay the same across runs.

---

## Cross-references

- `docs/canonical-narrative.md` — locked H-9 narrative, do not paraphrase
- `docs/demo-design.md` — long-form demo design, this script is the
  recording-ready abridgement
- `tools/integration-tests/results-full-flow-l4b-2026-05-02T20-24-05Z.md`
  — the captured seller19 run this script mirrors
- `tools/integration-tests/results-full-flow-l4d-seller11-2026-05-02.md`
  — earlier seller11 run, kept for reference
