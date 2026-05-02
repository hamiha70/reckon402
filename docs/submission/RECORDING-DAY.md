# Recording Day — wake-up cheat sheet

> **Deadline:** Sunday 2026-05-03 18:00 CEST.
> **Recording target:** fresh `seller22.reckon402-test.eth` (form prefilled, just press Deploy).
> **Plan:** ~30 min video shoot → 60–90 min screenshot capture + form paste + upload.

---

## Sequence (top to bottom, do not skip)

### 1. Open browser (fresh profile or clean cache)

```
Ctrl+Shift+N   # incognito window — guarantees no stale sessionStorage
```

Set browser zoom to 110–125% before recording (better for screen capture
readability without breaking the layout).

### 2. Tabs to pre-open (in this order)

| Tab | URL | Used in |
|-----|-----|---------|
| 1 | `https://reckon402.com` | Act 1 (landing) |
| 2 | `https://app.reckon402.com/#/` | Act 2 (onboard form) |
| 3 | (left blank — Act 2 will redirect here) | Act 3-5 (dashboard) |
| 4 | `https://reckon402.com/ens` | Optional B-roll |
| 5 | `https://reckon402.com/keeperhub` | Optional B-roll |
| 6 | `https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9` | Optional B-roll |

### 3. Pre-record sanity (one command)

```bash
just balance               # confirm Sepolia ETH still on the demo EOAs
curl -s https://app.reckon402.com/healthz                           # 200
curl -s https://gateway.reckon402.com/records/seller20.reckon402-test.eth | jq .records | head -3   # works
curl -s -X POST https://app.reckon402.com/demo/test-call \
  -H 'Content-Type: application/json' \
  -d '{"ensName":"seller20.reckon402-test.eth","query":"smoke"}' | jq -r .ok    # true
```

If anything is red, do NOT press record — see Plan B at the bottom of
`docs/demo-voiceover.md`.

### 4. Press record

Open `docs/demo-voiceover.md` on a second screen / phone for cue
reference. Six acts, ~3:00 total. Voiceovers are recorded separately
and synced in post — you don't have to deliver them live, just hit
the visual beats.

After Act 5 (Claim All result on screen): cut.

### 5. Pull screenshots from the recording

Don't run the flow twice. Pause the screen-capture file at these
moments and screenshot from the paused frame:

| Slot | Pause moment |
|------|--------------|
| 1 | Act 1, top-fold of `reckon402.com` (hero + "Architecture" twin-box) |
| 2 | Act 2 Beat 2A, form filled, before clicking Deploy |
| 3 | Act 2 Beat 2C, six green check-marks visible in progress panel |
| 4 | Act 3, dashboard top fold (header + ENS records expanded) |
| 5 | Act 4 conclusion, Recent paid calls table populated, attestationCount > 0 |
| 6 | Act 5, withdraw status with claim tx hash visible |

Slots 1–3 are the must-haves (form requires minimum 3); 4–6 are nice
extras for the 6-slot grid.

---

## After the video — submission paste targets

Open `docs/submission/form-ready.md` side-by-side with the ETHGlobal
form. It maps 1:1 to every form field with paste-ready content and
char counts.

### THREE corrections to your already-filled tech-stack form

| Field | Currently | Should be |
|-------|-----------|-----------|
| Networks | Base, **0G** | Base, **Ethereum** |
| Web frameworks | **Express, Next.js** | **Hono** |
| Databases | **None** | **Cloudflare D1** / **SQLite** |

If Hono / Cloudflare D1 aren't in the dropdown, add via the "other
technologies" free-text field.

### Image uploads

| Slot | File | Path |
|------|------|------|
| Logo (512×512) | `logo-512-dark.png` | `assets/brand/logo-512-dark.png` (rendered, ready to upload) |
| Logo alt | `logo-512-white.png` or `logo-512-transparent.png` | `assets/brand/` |
| Cover (16:9 640×360) | (already uploaded — green Reckon402 banner) | — |
| Screenshots ×3-6 | (capture from video frames) | save under `docs/screenshots/` |

### Video upload destination

YouTube (unlisted) or Loom — whichever lets you paste the URL into
the form's Video page fastest. Length 2:00–4:00.

---

## TL;DR — the only 5 things you'll actually do post-nap

1. ☐ Pre-record sanity (one bash block above) → all green
2. ☐ Open 6 tabs, press record, run the 6 acts (~3 min)
3. ☐ Screenshot 3–6 frames from the recording
4. ☐ Paste from `docs/submission/form-ready.md` into the form (every section maps 1:1)
5. ☐ Upload logo + cover + screenshots + video URL → click Submit

---

## Backups in case something goes sideways

| If this fails | Fallback |
|---------------|---------|
| Onboarding form (Act 2) | `just onboard-l4d seller22.reckon402-test.eth 0xD53ffac42496d73B3Faf946786688a8454F57b1f` (CLI, same 6 steps, ~75s) |
| `/demo/test-call` (Act 4) | `SELLER_NAME=seller22.reckon402-test.eth just fullflow-l4b` |
| `/demo/claim` (Act 5) | `infisical run -- bash -c 'cast send <ESCROW_ADDR> "withdrawAll()" --rpc-url "$BASE_SEPOLIA_RPC_PRIMARY" --private-key "$SELLER_PK"'` |
| `seller22` already taken | `seller23` is next free; bump `apps/frontend/dist/index.html` lines 48–49 + `just deploy-orchestrator` |
| Logo rendering off | Use `assets/brand/logo-512-transparent.png` and let ETHGlobal apply their own background |

Full plan-B section in `docs/demo-voiceover.md` (search "Plan B").

---

## State at sleep time

- Working tree: clean ✓
- Branch: `main`, up to date with `origin/main`
- Latest commit: `404d58b` (form-ready submission draft)
- Live surfaces: 9/9 → 200
- Form defaults: `seller22` / `0.01 USDC` ✓
- `seller22.reckon402-test.eth`: free (HTTP 404) ready to onboard live ✓
- Demo EOA balances on Base Sepolia (direct cast probe):
  - facilitator: 0.9998 ETH + 20.011 USDC
  - seller: 0.020 ETH + 20.467 USDC
  - buyer-demo-1: 0 ETH (gasless EIP-3009) + 19.470 USDC
  - deployer: 0.99996 ETH + 20.003 USDC
- All sufficient for ~10 demo iterations + claim with comfortable headroom.
