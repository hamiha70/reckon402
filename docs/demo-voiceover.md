# Reckon402 Demo Voiceover Script

> **Status:** updated 2026-05-02 (post H-9). All six acts drive from a
> single browser tab on `app.reckon402.com` — no terminal switch, no
> MetaMask popup, no agent worker re-deploy between acts. Onboarding
> (Act 2), paid call (Act 4), and claim (Act 5) each run from one button
> press; the orchestrator does the on-chain work behind the scenes
> using Infisical-piped wrangler secrets.
>
> **Recording target:** fresh `seller22.reckon402-test.eth` — onboarded
> live in Act 2, used through Acts 3–5. The form already defaults to
> `seller22` and `0.01 USDC` so Beat 2A is hit-record-and-go.
>
> **Verification reference:** `seller20` was the last verified
> end-to-end run (2026-05-02, settle tx `0x30d498f2…0314ec`, claim tx
> `0x2a205bf0…34f5cb75`). Used as the canonical example in the
> Common substitutions table and as the dashboard's default agent
> when a viewer opens a fresh tab post-recording.
>
> **Format.** Six acts, ~3:00 total. Each act lists the voiceover text and
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

### Beat 2A — The form (15s)

**Visual.**
1. Browser tab on `https://app.reckon402.com`.
2. Pause on the empty onboarding form, scroll once across the field layout
   (ENS label, SellingAgent EOA, HTTPS endpoint, base price per call,
   on-chain Escrow toggle ON).
3. The ENS label `seller22` is already prefilled (form default); the
   suffix `.reckon402-test.eth` is appended automatically. No typing
   required — just confirm and move on.

**Voiceover.**
> One form. ENS subname, the agent's wallet, the HTTPS endpoint that
> serves paid requests, the base price per call. The on-chain Escrow
> toggle is on by default — that's the new piece. No keys typed in the
> browser; the platform's onboarding wallet pays the gas and signs the
> seven on-chain transactions.

### Beat 2B — Submit (5s)

**Visual.**
1. Click the green **Deploy SellingAgent** button.
2. The "Onboarding progress" panel below the form transitions from
   `submitting…` to a six-line checklist with rotating spinners.

**Voiceover.**
> One click.

### Beat 2C — Six steps stream into the panel (30s)

**Visual.**
Let the six steps complete in the live progress panel — the panel is the
visual centerpiece for this beat, no terminal switch needed. Expected
elapsed times printed by the orchestrator next to each row:

```
✓ Mint ENS subname               ~16s   subname=seller22.reckon402-test.eth + Etherscan link
✓ Register ERC-8004 agentId      ~1.3s  agentId=<NEW> + Basescan link
✓ Deploy Escrow via factory      ~0.4s  escrow=0x<NEW> + Basescan link
✓ Deploy Splitter via factory    ~1.4s  splitter=0x<NEW> + Basescan link
✓ Set ENS records (gateway)      ~0.2s  records=13
✓ Seed gateway + transfer ENS    ~10s   ownership → 0xD53f…7b1f
```

The `<NEW>` placeholders are the live values produced during the
recording — the panel renders them with Basescan deep-links as each
step completes. Copy them into the screen-record post-mortem if you
want to cite them in the submission text later.

When all six rows are green, the right-hand side cards populate:
**Splitter recipients** (87% / 3% / 10%), **Risk-buffer release schedule**
(T0–T7 tier curve), and **ERC-8004 IDENTITY MINTED** card showing the
new agentId.

**Voiceover.**
> Six steps. ENS subname on Ethereum Sepolia. ERC-8004 identity NFT
> minted on Base Sepolia. A per-agent Escrow contract at a deterministic
> CREATE2 address — keyed to the agentId so the address is predictable
> before deployment. A Splitter routing 87 percent to the seller, 3
> percent to the facilitator, 10 percent into the agent's own Escrow on
> every settlement. Thirteen ENS text records signed and seeded into the
> CCIP-Read gateway. ENS ownership transferred to the seller's wallet.
> The platform provisioned all of this; it never owned it.

---

## Act 3 — The dashboard (30s)

**Visual.**
1. After Act 2 ends, click the dashboard link the form surfaces (or
   navigate directly to `https://app.reckon402.com/#/agent/seller22.reckon402-test.eth`).
2. Slow scroll top to bottom, pausing ~2 seconds on each panel:
   - Header (price 0.01 USDC, agentId from Act 2, Splitter, Escrow, owner)
   - Splitter recipients (87% / 3% / 10%)
   - ENS Text Records (collapsed bar — open it for ~3s to show 13 records)
   - Risk buffer (Escrow) — empty, attestations = 0, T0 active
   - Recent paid calls — "no calls yet"

**Voiceover.**
> This is the agent's dashboard. Per-agent Splitter, per-agent Escrow,
> thirteen signed ENS text records served from a CCIP-Read gateway.
> Right now the agent has zero attestations — tier T0 — so the Escrow
> would hold one hundred percent of the buffer if any payment landed.
> Nothing has paid this agent yet. Let's change that.

---

## Act 4 — A paid call (45s)

### Beat 4A — Trigger from the dashboard (10s)

**Visual.**
1. Stay on the dashboard tab. No terminal switch.
2. Click the **Run Test Call** button (top right, blue).
3. The status line beneath the buttons reads
   `Signing EIP-3009 + waiting for Splitter.distribute…` for ~3 seconds,
   then flips to
   `✓ settled: paymentId 0x1974fb43… · transfer tx 0x30d498f2…`.

**Voiceover.**
> One button. The orchestrator hits the agent worker, gets back a 402
> Payment Required with the price and the destination Splitter, signs
> an EIP-3009 transferWithAuthorization for one hundredth of a USDC,
> retries with the signed payment header, and the facilitator settles
> on Base Sepolia. End-to-end in about three seconds.

### Beat 4B — What landed on-chain (25s)

**Visual.**
1. Wait ~5 seconds for the next 3-second poll cycle on the dashboard.
2. The "Recent paid calls" table now has one row with three transaction
   hashes: settle, distribute, attest.
3. Click the **settle tx** (blue, leftmost). New tab on
   `sepolia.basescan.org/tx/0x30d498f2…0314ec`.
4. Scroll to the "ERC-20 Tokens Transferred" section so the three lines
   are visible: 0.0087 → seller, 0.0003 → facilitator, 0.0010 → Splitter.
5. Switch back to the dashboard tab.
6. Click the **distribute tx** (amber, middle column). New tab on
   `sepolia.basescan.org/tx/0xd5ba94d2…fac3f87`.
7. Scroll to "ERC-20 Tokens Transferred" so the Splitter → Escrow
   transfer line is visible (0.0010 USDC).
8. Switch back to the dashboard tab.
9. Click the **attest tx** (green, rightmost). New tab on
   `sepolia.basescan.org/tx/<attest>`.
10. Briefly highlight the `NewFeedback` event in the logs.

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
   T1 row is highlighted, `Total deposited 0.0010 USDC`,
   `Currently held 0.000950 USDC`, `Released to seller 5%`,
   `Withdrawable now 0.000050 USDC`.

**Voiceover.**
> The dashboard reads it back. One attestation. Tier walks from T0 to
> T1. Five percent of the deposited buffer is now released and claimable
> by the agent's owner. Ninety-five percent stays held until the next
> attestation walks the agent into T2.

---

## Act 5 — Claim (25s)

### Beat 5A — Connect wallet (10s)

**Visual.**
1. Click the **Connect Wallet** button (top right of dashboard, amber).
2. No popup — the dashboard reads `IdentityRegistry.ownerOf(agentId)`
   directly and "connects" as that address. About one RPC round-trip
   (~500ms).
3. Pause so the viewer sees:
   - Wallet status row appears: `connected: 0xD53f…7b1f`
   - Owner flag turns green: `✓ owner of agent NFT — can claim`
   - Claim row label changes from "Connect wallet to claim" to
     `Withdraw 0.000050 USDC to 0xD53f…7b1f`, button enabled, label `Claim All`.

**Voiceover.**
> The dashboard runs an eth_call to IdentityRegistry.ownerOf, sees the
> agent's NFT owner, and unlocks the Claim button. Withdraw is NFT-bound
> — only the account that owns the agent's IdentityRegistry token can
> authorize it. The orchestrator holds the seller's hot key for this
> demo so the click goes straight to settlement; in production, this is
> where the agent's owner would sign with their own wallet.

### Beat 5B — Claim (15s)

**Visual.**
1. Click **Claim All**.
2. The claim status line beneath the row reads `submitting tx…` for
   about a second, then flips to `✓ tx submitted: 0x2a205bf0…34f5cb75`
   with a Basescan link.
3. Click the link, new Basescan tab on the withdraw transaction.
4. Scroll to "ERC-20 Tokens Transferred" so the Escrow → seller line is
   visible (0.000050 USDC).
5. Switch back to dashboard tab.
6. Wait one poll cycle (~3s).
7. Risk Buffer panel updates: `Currently held 0.000950 USDC` (unchanged
   for now since only the released slice was withdrawn),
   `Withdrawable now 0.000000 USDC`,
   `Total withdrawn 0.000050 USDC`.

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

1. **Browser windows.** Two tabs prepared:
   - `reckon402.com` (Act 1)
   - `app.reckon402.com` — onboarding form, all fields ready except the
     ENS label which is typed live in Beat 2A (Acts 2, 3, 4, 5).
     Basescan jumps in Acts 4 and 5 open in fresh tabs from dashboard
     links — no pre-prepared blank tab needed.
2. **No terminal.** All six acts run from the browser. The
   onboarding form drives Act 2; the **Run Test Call** button in the
   dashboard header drives Act 4; the **Connect Wallet** + **Claim All**
   buttons drive Act 5. The orchestrator (server-side) signs everything,
   using `RECKON402_ONBOARDING_PK` for onboarding gas, `BUYER_DEMO_1_PK`
   for the test buyer call, and `SELLER_PK` for `Escrow.withdrawAll()`.
3. **No MetaMask.** The dashboard's wallet connect is hardwired to the
   agent NFT owner returned by `IdentityRegistry.ownerOf(agentId)` — no
   provider popup, no chain switch. (`apps/frontend/dist/app.js` →
   `DEMO_MODE = true`. Set false to restore the real EIP-1193 path.)
4. **No agent worker re-point.** The agent worker resolves price /
   Splitter / asset from the gateway per request via the dynamic
   `/<label>/research` route. Whichever ENS the dashboard is viewing
   is the ENS the test call hits — no wrangler.toml edits or
   `just deploy-agent` between Act 2 and Act 4.
5. **Recording target ENS is `seller22`** — the form prefills it. If
   you've already used `seller22` in a prior take, probe for the next
   free label with
   `bash tools/integration-tests/resolve-l4a.sh --backend static --name
   seller23.reckon402-test.eth --key x402.amount` and pick the lowest
   `N` that returns `UNKNOWN_NAME`. Then bump the form default in
   `apps/frontend/dist/index.html` and redeploy with
   `just deploy-orchestrator` before pressing record so Beat 2A stays
   no-typing.
6. **Confirm the demo endpoints are live** against an EXISTING agent
   (don't burn `seller22` on a smoke test):
   ```
   curl -s -X POST https://app.reckon402.com/demo/test-call \
     -H 'Content-Type: application/json' \
     -d '{"ensName":"seller20.reckon402-test.eth","query":"smoke"}' | jq .ok
   ```
   Expect `true`. If you get `503 demo_not_configured`, re-push
   `SELLER_PK` and `BUYER_DEMO_1_PK` via the wrangler-secret-put recipe
   in `tools/deploy/secrets-l4d.md` (TODO once that file exists).
7. **Tail.** Optionally keep `just tail-facilitator` and
   `just tail-orchestrator` running in background terminals (off-screen)
   so any silent failure shows up.

### Plan B — CLI fallback if the demo endpoints misbehave on the day

If the `/demo/test-call` or `/demo/claim` endpoint regresses during
recording (e.g. wrangler secret expired or a deploy reverted the demo
wiring), drop to terminal and run the equivalent commands:

```
# Equivalent of Run Test Call (Act 4)
SELLER_NAME=seller22.reckon402-test.eth just fullflow-l4b

# Equivalent of Claim All (Act 5)
infisical run --env dev --domain https://secrets.intentralabs.com -- \
  bash -c 'cast send <ESCROW_ADDR> "withdrawAll()" --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" --private-key "$SELLER_PK"'
```

Same on-chain artifacts; only the visual surface changes.

If the **web form** misbehaves on the day (Act 2 path), the CLI fallback
is `just onboard-l4d seller22.reckon402-test.eth 0xD53ffac42496d73B3Faf946786688a8454F57b1f` —
same six steps, ~75s total.

---

## Common substitutions

Recording target is `seller22` — the form already prefills it. The
table below lists what the script names vs what the recording will
produce live. `seller20` (settle tx `0x30d498f2…0314ec`, claim tx
`0x2a205bf0…34f5cb75`) was the last verified end-to-end run and stays
referenced in scripts and as the dashboard's default agent so anyone
who opens a fresh tab post-recording lands on a populated dashboard.

| Reference in script | Where it appears | Replace with |
|---------------------|------------------|--------------|
| `seller22.reckon402-test.eth` | All acts (form prefilled + dashboard + paid call) | leave as-is — that's the recording target |
| `agentId from Act 2` | Act 2 progress panel + Act 3 dashboard header | new agentId rendered live in the panel |
| `0x<NEW>` (Escrow) | Act 2 progress panel + Act 3 dashboard | new Escrow rendered live in the panel |
| `0x<NEW>` (Splitter) | Act 2 progress panel + Act 3 dashboard | new Splitter rendered live in the panel |
| `<settle tx>` | Act 4 Basescan jump | from Run Test Call response (`txHash`) |
| `<distribute tx>` | Act 4 Basescan jump | parsed from receipt `reconcileNotes` |
| `<attest tx>` | Act 4 Basescan jump | from receipt `td_erc8004_tx` |
| `<claim tx>` | Act 5 Basescan jump | from Claim All response (`txHash`) |

The price (`0.01 USDC`), the splits (87/3/10), the tier curve, and the
seller EOA (`0xD53ffac42496d73B3Faf946786688a8454F57b1f`) stay the same
across runs and are not substituted.

---

## Cross-references

- `docs/canonical-narrative.md` — locked H-9 narrative, do not paraphrase
- `docs/demo-design.md` — long-form demo design, this script is the
  recording-ready abridgement
- `tools/integration-tests/results-full-flow-l4b-2026-05-02T20-24-05Z.md`
  — the captured seller19 run this script mirrors
- `tools/integration-tests/results-full-flow-l4d-seller11-2026-05-02.md`
  — earlier seller11 run, kept for reference
