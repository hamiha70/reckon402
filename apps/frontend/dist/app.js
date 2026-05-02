// @ts-check
// Reckon402 L4c frontend — vanilla module, no bundler.
// Served at the same origin as the onboard-orchestrator worker so all fetches
// are relative paths (no CORS configuration).
//
// `// @ts-check` above flips on tsc-driven JSDoc-aware diagnostics for this
// file. Type-check via `pnpm typecheck` from apps/frontend/. The config is
// non-strict on purpose — the goal is catching typos, undefined vars, and
// wrong arg counts, not enforcing exhaustive type annotations. Full TS
// migration is a v1.5 polish item; until then JSDoc casts (e.g. window
// .ethereum) bridge the EIP-1193 boundary.

// ─── Config ───────────────────────────────────────────────────────────────
const CFG = {
  ORCHESTRATOR_BASE: '',                                    // same origin
  GATEWAY_BASE:      'https://gateway.reckon402.com',
  FACILITATOR_BASE:  'https://facilitator.reckon402.com',
  BASE_SEPOLIA_RPC:  'https://sepolia.base.org',
  PARENT_ENS:        'reckon402-test.eth',
  POLL_MS:           3_000,
  BASESCAN_TX:       'https://sepolia.basescan.org/tx/',
  BASESCAN_ADDR:     'https://sepolia.basescan.org/address/',
  ETHERSCAN_TX:      'https://sepolia.etherscan.io/tx/',
  ETHERSCAN_ADDR:    'https://sepolia.etherscan.io/address/',
}

// Demo-mode flag: when true, "Run Test Call" and "Connect Wallet" + "Claim All"
// route through orchestrator-hosted server-side endpoints (POST /demo/test-call
// + POST /demo/claim) using SELLER_PK / BUYER_DEMO_1_PK from Infisical-piped
// wrangler secrets. No MetaMask, no KH workflow round-trip — both flows fire
// from a single button click and surface a real on-chain tx hash inline. See
// workers/onboard-orchestrator/src/demo-{claim,test-call}.ts. Set false to
// restore the original MetaMask + KH-link behavior.
const DEMO_MODE = true

// Reckon402-controlled EOAs that share the SellingAgent's Splitter recipient
// list. Public addresses, safe to ship in client JS. Source: AGENTS.md §"On-chain
// EOAs (v1, locked)".
const FACILITATOR_EOA = '0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455' // facilitator + deployer fee slot
const RISK_BUFFER_EOA = '0x66C2858D9A8605957c516a77262Eb66EE6be113C' // accrues escrow per settlement

// Splitter BPS triple shipped with every new SellingAgent. 87% to the seller
// upfront, 3% constant facilitator+deployer fee, 10% to the risk-buffer EOA
// where it accrues as escrow and is conceptually released back to the seller
// as on-chain attestations grow (see TIERS below). On-chain release contract
// is v1.5. Sum MUST equal 10_000 (basis-point integrity).
const SELLER_BPS         = 8_700
const FACILITATOR_BPS    = 300
const RISK_BUFFER_BPS    = 1_000

// Risk-buffer release schedule (Candidate C — 8-tier, exponentially-spaced
// thresholds, gentler drawdown than the v0 four-step ramp). `releaseBps` is
// the fraction of accrued buffer the seller is treated as having reclaimed at
// this attestation count. Buyer-facing price is constant; this only affects
// the "claimable" view in the UI.
const TIERS = [
  { min: 0,    code: 'T0', label: 'T0 — new',          releaseBps:     0, bgCls: 'bg-gray-700',     textCls: 'text-gray-300'   },
  { min: 1,    code: 'T1', label: 'T1 — first-call',   releaseBps:   500, bgCls: 'bg-slate-700',    textCls: 'text-slate-200'  },
  { min: 3,    code: 'T2', label: 'T2 — active',       releaseBps: 1_500, bgCls: 'bg-blue-800',     textCls: 'text-blue-200'   },
  { min: 10,   code: 'T3', label: 'T3 — reliable',     releaseBps: 3_000, bgCls: 'bg-cyan-800',     textCls: 'text-cyan-200'   },
  { min: 30,   code: 'T4', label: 'T4 — established',  releaseBps: 5_000, bgCls: 'bg-teal-800',     textCls: 'text-teal-200'   },
  { min: 100,  code: 'T5', label: 'T5 — trusted',      releaseBps: 7_000, bgCls: 'bg-emerald-800',  textCls: 'text-emerald-200'},
  { min: 300,  code: 'T6', label: 'T6 — proven',       releaseBps: 8_500, bgCls: 'bg-green-800',    textCls: 'text-green-200'  },
  { min: 1000, code: 'T7', label: 'T7 — veteran',      releaseBps:10_000, bgCls: 'bg-green-600',    textCls: 'text-green-100'  },
]

// Cosmetic mirror of the on-chain Splitter recipient list. Used by the
// onboarding-form summary panel only.
const SPLIT_DISPLAY = [
  { label: '0xD53f… (seller)',                 bps: SELLER_BPS },
  { label: '0x0A02… (facilitator + deployer)', bps: FACILITATOR_BPS },
  { label: '0x66C2… (risk buffer / escrow)',   bps: RISK_BUFFER_BPS },
]

// IdentityRegistry on Base Sepolia (chainId 84532) — pinned in
// AGENTS.md "L4a2 ERC-8004 client + reads".
const IDENTITY_REGISTRY_BASE_SEPOLIA = '0x8004A818BFB912233c491871b3d84c89A494BD9e'

// Base Sepolia EIP-155 chainId, hex form for wallet_switchEthereumChain.
const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34'  // 84532

// Function selectors (4-byte) — precomputed via `cast sig` against
// contracts/src/Escrow.sol + IdentityRegistry. Hardcoded so the frontend
// doesn't need a runtime keccak library.
const SEL = {
  getStats:          '0xc59d4847', // Escrow.getStats() — 7 return slots
  withdrawAll:       '0x853828b6', // Escrow.withdrawAll() — no args
  withdraw:          '0x2e1a7d4d', // Escrow.withdraw(uint256)
  ownerOf:           '0x6352211e', // IERC721.ownerOf(uint256)
  getAllRecipients:  '0xb74513c1', // Splitter.getAllRecipients() (address[],uint16[])
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel) }
function $$(sel) { return [...document.querySelectorAll(sel)] }
function trunc(addr, n = 6) {
  if (!addr || addr.length < 12) return addr ?? '—'
  return addr.slice(0, n + 2) + '…' + addr.slice(-4)
}
function fmtUsdc(raw) {
  if (!raw && raw !== 0 && raw !== '0') return '—'
  const n = Number(raw) / 1e6
  return n.toFixed(n < 0.01 ? 6 : 4) + ' USDC'
}
function fmtTs(ms) {
  if (!ms) return '—'
  return new Date(Number(ms)).toLocaleTimeString()
}
function activeTier(count) {
  let best = TIERS[0]
  for (const t of TIERS) if (count >= t.min) best = t
  return best
}
// Parse a human-typed USDC decimal ("0.10", "1.5", "100") into atomic-units
// string ("100000", "1500000", "100000000"). USDC has 6 decimals.
// Returns null if input is malformed (caller decides what to do).
function parseUsdcDecimalToAtomic(s) {
  const cleaned = String(s ?? '').trim()
  if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const fracPadded = (frac + '000000').slice(0, 6)
  const combined = (whole + fracPadded).replace(/^0+/, '')
  return combined === '' ? '0' : combined
}
// Per-call buffer slice in atomic USDC. Uses BigInt to avoid float drift on
// large amounts.
function bufferPerCallAtomic(baseAtomic) {
  if (baseAtomic == null) return 0n
  return (BigInt(baseAtomic) * BigInt(RISK_BUFFER_BPS)) / 10_000n
}
// Released slice of accrued buffer at a given tier, in atomic USDC.
function releasedAtomic(accrued, tier) {
  return (accrued * BigInt(tier.releaseBps)) / 10_000n
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Minimal ABI codec ───────────────────────────────────────────────────
// Pads a hex value (no 0x) to 32-byte (64-char) slots, leftpad with zeros.
function pad32(hexNo0x) {
  const h = hexNo0x.startsWith('0x') ? hexNo0x.slice(2) : hexNo0x
  return h.padStart(64, '0')
}
// Encode a uint256 as a 32-byte slot (BigInt-safe).
function encUint256(v) {
  const big = typeof v === 'bigint' ? v : BigInt(v)
  return pad32(big.toString(16))
}
// Encode an address as a 32-byte slot.
function encAddress(addr) {
  return pad32(String(addr).replace(/^0x/, '').toLowerCase())
}
// Decode a 0x-prefixed eth_call result as an array of 32-byte hex strings (no 0x prefix).
function decodeSlots(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const slots = []
  for (let i = 0; i < h.length; i += 64) slots.push(h.slice(i, i + 64))
  return slots
}
function slotToBigInt(slot) { return BigInt('0x' + slot) }
function slotToAddress(slot) { return '0x' + slot.slice(24) }

// Single-shot eth_call against the public Base Sepolia RPC. `to` is the
// contract address, `selector` is 0x-prefixed 4-byte fn selector, `args` is
// the already-encoded calldata tail (no 0x prefix). Returns raw 0x-hex.
async function ethCall(rpcUrl, to, selector, encodedArgsNo0x = '') {
  const data = selector + encodedArgsNo0x
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  }
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`)
  return json.result
}

// Read Escrow.getStats() — returns the 7-tuple as a plain object.
async function readEscrowStats(rpcUrl, escrowAddr) {
  const raw = await ethCall(rpcUrl, escrowAddr, SEL.getStats, '')
  const slots = decodeSlots(raw)
  if (slots.length < 7) throw new Error(`bad getStats() response: ${raw}`)
  return {
    totalDeposited:   slotToBigInt(slots[0]),
    currentlyHeld:    slotToBigInt(slots[1]),
    totalWithdrawn:   slotToBigInt(slots[2]),
    releasedAmount:   slotToBigInt(slots[3]),
    withdrawableNow:  slotToBigInt(slots[4]),
    attestationCount: Number(slotToBigInt(slots[5])),  // uint64 fits in JS number
    releasedBps:      Number(slotToBigInt(slots[6])),  // uint16 fits
  }
}

// Read IdentityRegistry.ownerOf(agentId) — returns the owner EOA (lowercase).
async function readNftOwner(rpcUrl, identityRegistry, agentId) {
  const raw = await ethCall(rpcUrl, identityRegistry, SEL.ownerOf, encUint256(agentId))
  const slots = decodeSlots(raw)
  if (!slots[0]) throw new Error(`bad ownerOf() response: ${raw}`)
  return slotToAddress(slots[0]).toLowerCase()
}

// Read Splitter.getAllRecipients() — returns the immutable (recipients, bps)
// pair as parallel arrays. Splitter values are constructor-locked, so the
// caller can cache by splitter address forever.
//
// ABI layout for `(address[] memory, uint16[] memory)` from a view return:
//   slot 0: head offset of array A (in bytes)
//   slot 1: head offset of array B
//   ...
//   at byte offset_A: slot = length(A)
//   following slots: A[0], A[1], ...
//   at byte offset_B: slot = length(B)
//   following slots: B[0], B[1], ...
async function readSplitterRecipients(rpcUrl, splitterAddr) {
  const raw = await ethCall(rpcUrl, splitterAddr, SEL.getAllRecipients, '')
  const slots = decodeSlots(raw)
  if (slots.length < 4) throw new Error(`bad getAllRecipients() response: ${raw}`)

  const offA = Number(slotToBigInt(slots[0])) / 32
  const offB = Number(slotToBigInt(slots[1])) / 32
  const lenA = Number(slotToBigInt(slots[offA]))
  const lenB = Number(slotToBigInt(slots[offB]))
  if (lenA !== lenB) throw new Error(`recipients/bps length mismatch: ${lenA} vs ${lenB}`)

  const recipients = []
  const bps        = []
  for (let i = 0; i < lenA; i++) recipients.push(slotToAddress(slots[offA + 1 + i]))
  for (let i = 0; i < lenB; i++) bps.push(Number(slotToBigInt(slots[offB + 1 + i])))
  return { recipients, bps }
}

// ─── Routing (hash-based) ─────────────────────────────────────────────────
//
// Two views, two top-nav links:
//   #/                                  → onboarding form  (`onboard` link)
//   #/agent/<ensName>                   → dashboard for that agent
//   #/agent/                            → redirect to the last-viewed agent,
//                                         falling back to DEFAULT_AGENT_ENS.
//
// The dashboard nav link's href stays sticky to the last visited agent so
// the toggle "dashboard ↔ onboard" works as a back-and-forth without ever
// landing on an empty hash.

const DEFAULT_AGENT_ENS = 'seller20.reckon402-test.eth'
// Key suffix is bumped whenever the canonical demo agent rotates, so stale
// sessionStorage from prior testing sessions is silently invalidated.
const LAST_AGENT_KEY    = 'reckon402:lastAgentEns:v2'

function getLastAgentEns() {
  try {
    return sessionStorage.getItem(LAST_AGENT_KEY) || DEFAULT_AGENT_ENS
  } catch {
    return DEFAULT_AGENT_ENS
  }
}
function rememberAgentEns(ens) {
  if (!ens) return
  try { sessionStorage.setItem(LAST_AGENT_KEY, ens) } catch { /* private mode etc. */ }
  const dashLink = $('#nav-dashboard')
  if (dashLink) dashLink.setAttribute('href', `#/agent/${encodeURIComponent(ens)}`)
}

function activate(viewId) {
  for (const v of $$('.view')) v.classList.remove('active')
  const el = $(`#${viewId}`)
  if (el) el.classList.add('active')
}

async function route() {
  const h = location.hash || '#/'
  if (h.startsWith('#/agent/')) {
    const ens = decodeURIComponent(h.slice('#/agent/'.length))
    if (ens) {
      rememberAgentEns(ens)
      activate('view-dashboard')
      startDashboard(ens)
      return
    }
    // Empty agent path → redirect to the last-viewed agent. Use replace so
    // the empty-hash entry doesn't pollute browser history (back button stays
    // useful).
    const fallback = getLastAgentEns()
    location.replace(`#/agent/${encodeURIComponent(fallback)}`)
    return
  }
  activate('view-onboard')
  stopDashboard()
}
window.addEventListener('hashchange', route)

// Sync the dashboard nav link to the last-viewed agent (or default) on first
// load so a fresh visitor's first click goes somewhere meaningful.
rememberAgentEns(getLastAgentEns())

// ─── Onboarding form ──────────────────────────────────────────────────────
const form = $('#onboard-form')
const labelInput = form?.querySelector('input[name="label"]')
const ensPreview = $('#ens-preview')

// Captures the seller EOA at form-submit time so the agent-mint card can show
// the wallet that will receive the freshly-minted IdentityRegistry NFT. Set
// before the POST /onboard request, read by renderAgentMintCard().
let pendingOnboard = null

if (labelInput && ensPreview) {
  labelInput.addEventListener('input', () => {
    ensPreview.textContent = `${labelInput.value || 'seller?'}.${CFG.PARENT_ENS}`
  })
}

// Tracks which onboarding flow the user picked (5-step legacy or 6-step L4d).
// Read by renderSteps() to pick the correct label set + step count.
let activeFlowL4d = false

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(form)
  const label     = String(fd.get('label')     ?? '')
  const sellerEoa = String(fd.get('sellerEoa') ?? '')
  const endpoint  = String(fd.get('endpoint')  ?? '')
  const amountInput = String(fd.get('amount')  ?? '')
  const enableL4dEscrow = $('#l4d-toggle')?.checked ?? false
  const name = `${label}.${CFG.PARENT_ENS}`

  activeFlowL4d = enableL4dEscrow

  // Reset the agent-mint card from any prior submit on the same page load,
  // then stash the form context so renderAgentMintCard can populate `owner`.
  $('#agent-mint-card')?.classList.add('hidden')
  pendingOnboard = { sellerEoa, ensName: name }

  const panel = $('#progress-panel')
  panel.classList.remove('hidden')
  const stepsList = $('#progress-steps')
  stepsList.innerHTML = '<li class="text-gray-500">submitting…</li>'

  // Parse decimal USDC → atomic. The orchestrator + ENS records expect atomic.
  const amountAtomic = parseUsdcDecimalToAtomic(amountInput)
  if (amountAtomic === null) {
    showOnboardError(`base price must be a USDC decimal (e.g. 0.10) — got "${amountInput}"`)
    return
  }

  // L4d flow: orchestrator picks recipients itself (3-way Splitter to
  //   [seller, FACILITATOR_FEE_EOA, predictedEscrow]). We do NOT send
  //   recipients/bps because the predicted Escrow address only exists
  //   server-side after AgentID step lands.
  // Legacy flow: 3-recipient Splitter with the shared risk-buffer EOA.
  //   Factory enforces recipients[0] === sellerEoa; we mirror that here.
  const payload = { name, sellerEoa, endpoint, amount: amountAtomic, enableL4dEscrow }
  if (!enableL4dEscrow) {
    payload.recipients = [sellerEoa, FACILITATOR_EOA, RISK_BUFFER_EOA]
    payload.bps        = [SELLER_BPS,  FACILITATOR_BPS, RISK_BUFFER_BPS]
  }

  let res
  try {
    res = await fetch(`${CFG.ORCHESTRATOR_BASE}/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    showOnboardError(`network error: ${err.message}`)
    return
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    showOnboardError(`orchestrator returned ${res.status}: ${text}`)
    return
  }
  const { onboardId } = await res.json()
  pollOnboardStatus(onboardId, name)
})

function showOnboardError(msg) {
  const el = $('#progress-error')
  el.textContent = msg
  el.classList.remove('hidden')
}

async function pollOnboardStatus(onboardId, ensName) {
  const stepsList = $('#progress-steps')
  let done = false
  while (!done) {
    let res
    try {
      res = await fetch(`${CFG.ORCHESTRATOR_BASE}/onboard/${onboardId}/status`)
    } catch (err) {
      showOnboardError(`status fetch failed: ${err.message}`)
      await new Promise(r => setTimeout(r, 1500))
      continue
    }
    if (!res.ok) {
      showOnboardError(`status ${res.status}`)
      return
    }
    const progress = await res.json()
    renderSteps(stepsList, progress.steps)
    if (progress.status === 'succeeded') {
      done = true
      // Slight pause so the user gets a visible beat on the agent-mint card
      // before we transition to the dashboard view.
      setTimeout(() => {
        location.hash = `#/agent/${encodeURIComponent(ensName)}`
      }, 2_500)
    } else if (progress.status === 'failed') {
      done = true
      const err = progress.result?.error ?? 'onboarding failed'
      showOnboardError(err)
    } else {
      await new Promise(r => setTimeout(r, 1_000))
    }
  }
}

// Step-label sets. The L4d flow reorders + extends the legacy set, so we keep
// both side-by-side and key off `activeFlowL4d` set at form-submit time.
// Source of truth: tools/onboard/src/orchestrator.ts (legacy + L4d branches).
const STEP_LABELS_LEGACY = {
  1: 'Mint ENS subname',
  2: 'Deploy Splitter via factory',
  3: 'Register ERC-8004 agentId',
  4: 'Set ENS records (gateway bootstrap)',
  5: 'Seed gateway + transfer ENS ownership',
}
const STEP_LABELS_L4D = {
  1: 'Mint ENS subname',
  2: 'Register ERC-8004 agentId',
  3: 'Deploy Escrow via factory',
  4: 'Deploy Splitter via factory',
  5: 'Set ENS records (gateway bootstrap)',
  6: 'Seed gateway + transfer ENS ownership',
}

function renderSteps(el, steps) {
  const labels = activeFlowL4d ? STEP_LABELS_L4D : STEP_LABELS_LEGACY
  const ids = Object.keys(labels).map(Number)
  el.innerHTML = ''
  for (const id of ids) {
    const step = steps.find(s => s.id === id)
    const li = document.createElement('li')
    li.className = 'flex items-center gap-2 py-1'
    let icon = '…'
    let cls = 'text-gray-500'
    if (step) {
      if (step.error) { icon = '✗'; cls = 'text-red-400' }
      else if (step.completedAt) { icon = '✓'; cls = 'text-green-400' }
      else { icon = '▶'; cls = 'text-blue-400' }
    }
    const noteHtml = step?.note
      ? `<span class="text-xs text-amber-200 font-mono">${formatNoteHtml(step.note)}</span>`
      : ''
    const link = step?.externalLink
      ? `<a href="${step.externalLink}" target="_blank" class="text-blue-400 underline hover:text-blue-300 text-xs font-mono">${trunc(step.txHash ?? step.externalLink, 8)}</a>`
      : ''
    const dur = step ? formatStepDuration(step) : ''
    li.innerHTML = `<span class="${cls} w-6 text-center font-bold">${icon}</span>
                    <span class="${cls}">${labels[id]}</span>
                    <span class="text-[10px] text-gray-600 font-mono ml-1 tabular-nums">${dur}</span>
                    <span class="ml-auto flex items-center gap-2">${noteHtml}${link}</span>`
    el.appendChild(li)
  }
  renderAgentMintCard(steps)
}

// Returns "0.4s" / "1.2s" / "12.3s" once a step has completed (or errored).
// While the step is still in-flight we show nothing — the duration only
// becomes meaningful once startedAt + completedAt are both populated.
function formatStepDuration(step) {
  if (!step?.startedAt || !step?.completedAt) return ''
  const ms = Number(step.completedAt) - Number(step.startedAt)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = ms / 1000
  return `${s.toFixed(s >= 10 ? 1 : 2)}s`
}

// Render an orchestrator-emitted note with light formatting:
//   - "key=value" pairs render as `<dim>key=</dim><bright>value</bright>`
//   - 0x-hex values long enough to be addresses or tx hashes are truncated.
function formatNoteHtml(note) {
  const m = String(note ?? '').match(/^([a-zA-Z0-9._-]+)=(.+)$/)
  if (!m) return escapeHtml(String(note ?? ''))
  const key = m[1]
  let value = m[2]
  if (/^0x[0-9a-fA-F]{40,}$/.test(value)) value = trunc(value, 6)
  return `<span class="text-amber-200/70">${escapeHtml(key)}=</span><span class="text-amber-200">${escapeHtml(value)}</span>`
}

// Reveals the agent-mint result card once the AgentID step completes with
// a `note` of the form `agentId=<n>`. The step ID is 3 in the legacy flow
// and 2 in the L4d flow — we just scan all steps for the first agentId
// note rather than hardcoding the position. Owner address comes from
// `pendingOnboard` stashed at form submit.
function renderAgentMintCard(steps) {
  const cardEl = $('#agent-mint-card')
  if (!cardEl || !pendingOnboard) return
  let mintStep = null
  for (const s of steps) {
    if (s?.note && /^agentId=\d+$/.test(s.note)) { mintStep = s; break }
  }
  if (!mintStep) return

  const agentId = mintStep.note.slice('agentId='.length)
  $('#mint-agent-id').textContent = `#${agentId}`
  $('#mint-owner').textContent = pendingOnboard.sellerEoa
  const txEl = $('#mint-tx')
  if (mintStep.txHash && txEl) {
    txEl.innerHTML = `<a href="${CFG.BASESCAN_TX}${mintStep.txHash}" target="_blank" class="text-blue-400 underline">${trunc(mintStep.txHash, 8)}</a>`
  } else if (txEl) {
    txEl.textContent = '—'
  }
  cardEl.classList.remove('hidden')
}

// ─── Dashboard ────────────────────────────────────────────────────────────
let dashboardTimer = null
let activeEns = null

// Per-dashboard cache of the latest on-chain Escrow snapshot. Set by
// refreshDashboard when an x402.escrow record is present. Consumed by
// renderBufferPanel + claim-button gating.
let escrowSnapshot = null
let escrowAddrCached = null
let agentIdCached    = null
// Splitter config is constructor-locked so we cache by splitter address.
// Map<splitterAddrLower, { recipients: string[], bps: number[] }>.
const splitterConfigCache = new Map()
let splitterAddrCached = null

function startDashboard(ens) {
  stopDashboard()
  activeEns = ens
  escrowSnapshot = null; escrowAddrCached = null; agentIdCached = null
  splitterAddrCached = null
  // Reset wallet-status row so a stale state from a prior agent doesn't
  // leak across navigations.
  refreshClaimGate()
  $('#dashboard-ens').textContent = ens
  // Buyer-facing price is constant. We pull base records directly (?backend=static)
  // so the dashboard never silently inherits any gateway-side discount logic.
  $('#terminal-url').textContent =
    `${new URL(CFG.GATEWAY_BASE).host}/records/${ens}?flat=true&backend=static`
  renderTierTable(0)
  refreshDashboard()
  dashboardTimer = setInterval(refreshDashboard, CFG.POLL_MS)
}
function stopDashboard() {
  if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null }
  activeEns = null
}

async function refreshDashboard() {
  if (!activeEns) return
  try {
    // Records first — we need the per-agent Splitter address to scope the
    // receipts query so each agent's dashboard only shows its own paid calls.
    // The added latency vs Promise.all is ~one network round-trip and the
    // tradeoff is worth it for filter correctness on first paint.
    const recordsRes = await fetchRecords(activeEns)
    splitterAddrCached = recordsRes.splitter ?? null
    const receiptsRes = await fetchRecentReceipts(splitterAddrCached)

    renderDashboardHeader(recordsRes)
    renderTerminalPane(recordsRes)
    renderEnsRecords(recordsRes.allRecords)
    renderCallLog(receiptsRes, splitterAddrCached)

    escrowAddrCached = recordsRes.escrow ?? null
    agentIdCached    = recordsRes.agentId ?? null

    // Splitter is immutable so we read once per address and reuse forever.
    if (splitterAddrCached) {
      const key = splitterAddrCached.toLowerCase()
      let cfg = splitterConfigCache.get(key)
      if (!cfg) {
        try {
          cfg = await readSplitterRecipients(CFG.BASE_SEPOLIA_RPC, splitterAddrCached)
          splitterConfigCache.set(key, cfg)
        } catch (err) {
          console.error('splitter getAllRecipients failed', err)
        }
      }
      if (cfg) renderSplitterRecipients(cfg, recordsRes.escrow)
    } else {
      renderSplitterRecipients(null)
    }

    // L4d on-chain mode: pull the authoritative counters from
    // Escrow.getStats() directly. Falls back to off-chain accounting if
    // the eth_call fails or no x402.escrow record is present.
    if (escrowAddrCached) {
      try {
        escrowSnapshot = await readEscrowStats(CFG.BASE_SEPOLIA_RPC, escrowAddrCached)
      } catch (err) {
        console.error('escrow getStats failed', err)
        escrowSnapshot = null
      }
    } else {
      escrowSnapshot = null
    }

    if (escrowSnapshot) {
      // On-chain: trust attestationCount from the contract (single source).
      const count = escrowSnapshot.attestationCount
      const tier = activeTier(count)
      $('#trust-count').textContent = String(count)
      const badge = $('#trust-badge')
      badge.className = `ml-auto px-3 py-1 rounded text-xs font-bold ${tier.bgCls} ${tier.textCls}`
      badge.textContent = tier.label
      renderBufferPanelOnChain(escrowSnapshot)
      renderTierTable(count)
    } else {
      // Off-chain accounting (legacy seller9 path)
      const attestationCount = (receiptsRes ?? []).filter(r => r.tdErc8004Tx).length
      const tier = activeTier(attestationCount)
      $('#trust-count').textContent = String(attestationCount)
      const badge = $('#trust-badge')
      badge.className = `ml-auto px-3 py-1 rounded text-xs font-bold ${tier.bgCls} ${tier.textCls}`
      badge.textContent = tier.label
      renderBufferPanel(recordsRes.baseAmount, attestationCount, tier)
      renderTierTable(attestationCount)
    }

    // Repaint claim-button gate every refresh so changes in wallet state
    // (connect / disconnect / chain switch / NFT transfer) flow through.
    await refreshClaimGate()
  } catch (err) {
    console.error('dashboard refresh failed', err)
  }
}

async function fetchRecords(ens) {
  try {
    const url = `${CFG.GATEWAY_BASE}/records/${encodeURIComponent(ens)}?flat=true&backend=static`
    const res = await fetch(url)
    if (!res.ok) return { baseAmount: null, allRecords: {} }
    const body = await res.json()
    const records = body?.records ?? {}
    const amount = records['x402.amount'] ?? null
    return {
      baseAmount: amount,
      allRecords: records,
      splitter:  records['x402.splitter'] ?? null,
      escrow:    records['x402.escrow']   ?? null,
      agentId:   records['x402.erc8004.agent_id'] ?? null,
      endpoint:  records['x402.endpoint'] ?? null,
    }
  } catch {
    return { baseAmount: null, allRecords: {} }
  }
}

// Receipts are fetched via the orchestrator proxy (/receipts) which adds
// server-side Bearer auth. The frontend never sees the ADMIN_TOKEN.
//
// payTo (optional) — per-agent Splitter address. When passed, the facilitator
// returns only receipts whose auth_to matches, so each agent's dashboard
// shows just its own paid calls instead of every settlement on the
// facilitator. Falls back to all-receipts when omitted.
async function fetchRecentReceipts(payTo) {
  try {
    const params = new URLSearchParams({ limit: '20' })
    if (payTo) params.set('payTo', payTo)
    const res = await fetch(`${CFG.ORCHESTRATOR_BASE}/receipts?${params.toString()}`)
    if (!res.ok) return []
    const body = await res.json()
    return Array.isArray(body?.receipts) ? body.receipts : []
  } catch {
    return []
  }
}

function renderDashboardHeader(r) {
  const price = r.baseAmount ?? null
  $('#dash-current-price').textContent = price !== null ? fmtUsdc(price) : '—'
  $('#dash-endpoint').textContent = r.endpoint ?? '—'

  const splitterEl = $('#dash-splitter')
  if (r.splitter) {
    splitterEl.innerHTML = `<a href="${CFG.BASESCAN_ADDR}${r.splitter}" target="_blank" class="text-blue-400 underline">${trunc(r.splitter)}</a>`
  } else {
    splitterEl.textContent = '—'
  }

  const escrowEl = $('#dash-escrow')
  if (r.escrow) {
    escrowEl.innerHTML = `<a href="${CFG.BASESCAN_ADDR}${r.escrow}" target="_blank" class="text-blue-400 underline">${trunc(r.escrow)}</a>`
  } else if (escrowEl) {
    escrowEl.innerHTML = '<span class="text-gray-600 text-xs italic">legacy (no per-agent escrow)</span>'
  }

  $('#dash-agent-id').textContent = r.agentId ?? '—'
  $('#dash-owner').textContent = '—'  // not returned by flat-records; populated if needed
}

// Render the on-chain Splitter recipients table. `cfg` is { recipients, bps }
// from readSplitterRecipients(), or null if no splitter could be resolved.
// `escrowAddr` is the per-agent Escrow address (lowercase) from the gateway —
// used to render the escrow row with a distinct label, since the address
// alone is opaque.
function renderSplitterRecipients(cfg, escrowAddr) {
  const tbody = $('#splitter-recipients-table')
  if (!tbody) return
  if (!cfg || !cfg.recipients || cfg.recipients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-gray-600 italic py-2 text-center text-xs">no splitter found for this agent</td></tr>`
    return
  }
  const escrowLower = (escrowAddr ?? '').toLowerCase()
  const facilitatorLower = '0x0a0228e6a5e1d7be234a190a8d9a3af9e08ec455'
  const riskBufferLower  = '0x66c2858d9a8605957c516a77262eb66ee6be113c'

  const rows = cfg.recipients.map((addr, i) => {
    const lower = addr.toLowerCase()
    let label = ''
    if (i === 0)                       label = 'seller'
    else if (lower === facilitatorLower) label = 'facilitator fee'
    else if (lower === escrowLower && escrowLower) label = 'per-agent Escrow'
    else if (lower === riskBufferLower) label = 'shared risk-buffer EOA (legacy)'
    const labelHtml = label
      ? `<span class="ml-2 text-[10px] uppercase tracking-wider text-gray-500">${escapeHtml(label)}</span>`
      : ''
    const bps = cfg.bps[i] ?? 0
    const pct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)
    return `
      <tr class="border-t border-gray-800/60">
        <td class="py-1.5 text-gray-500 text-xs">${i}</td>
        <td class="py-1.5 break-all">
          <a href="${CFG.BASESCAN_ADDR}${addr}" target="_blank" class="text-blue-400 underline">${trunc(addr, 8)}</a>
          ${labelHtml}
        </td>
        <td class="py-1.5 text-right text-gray-300">${bps}</td>
        <td class="py-1.5 text-right text-amber-200 font-bold tabular-nums">${pct}%</td>
      </tr>`
  })
  const sumBps = cfg.bps.reduce((a, b) => a + b, 0)
  const sumOk = sumBps === 10_000
  rows.push(`
    <tr class="border-t border-gray-800">
      <td class="py-1.5"></td>
      <td class="py-1.5 text-[10px] uppercase tracking-wider text-gray-500">sum</td>
      <td class="py-1.5 text-right text-gray-400">${sumBps}</td>
      <td class="py-1.5 text-right ${sumOk ? 'text-emerald-300' : 'text-red-300'} font-bold">${(sumBps / 100).toFixed(0)}%${sumOk ? '' : ' (!)'}</td>
    </tr>`)
  tbody.innerHTML = rows.join('')
}

function renderTerminalPane(r) {
  const out = r.baseAmount ?? '100000'
  const snippet = { records: { 'x402.amount': out } }
  if (r.splitter) snippet.records['x402.splitter'] = r.splitter
  if (r.agentId)  snippet.records['x402.erc8004.agent_id'] = r.agentId
  $('#terminal-output').textContent = JSON.stringify(snippet, null, 2)
}

// Risk-buffer accounting (legacy / off-chain mode): every settlement deposits
// `bufferPerCallAtomic` into the shared risk-buffer EOA. The seller's
// "claimable" balance is the accrued total times the current tier's release
// fraction. The on-chain Escrow.getStats() path supersedes this when an
// x402.escrow record exists; see renderBufferPanelOnChain.
function renderBufferPanel(baseAmount, attestationCount, tier) {
  $('#escrow-mode-badge').textContent = 'off-chain accounting'
  $('#escrow-mode-badge').className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-gray-800 text-gray-500'
  $('#buf-row1-label').textContent = 'Per-call buffer'
  $('#buf-row2-label').textContent = 'Total accrued'
  $('#buf-row3-label').textContent = 'Released to seller'
  $('#buf-row4-label').textContent = 'Claimable now'
  $('#buf-row5-label').classList.add('hidden')
  $('#buffer-withdrawn').classList.add('hidden')
  $('#escrow-foot-on').classList.add('hidden')
  $('#escrow-foot-off').classList.remove('hidden')

  const baseAtomic = baseAmount ?? '100000'
  const perCall   = bufferPerCallAtomic(baseAtomic)
  const accrued   = perCall * BigInt(attestationCount)
  const released  = releasedAtomic(accrued, tier)
  $('#buffer-per-call').textContent = fmtUsdc(perCall.toString())
  $('#buffer-accrued').textContent  = fmtUsdc(accrued.toString())
  $('#buffer-released').textContent = `${(tier.releaseBps / 100).toFixed(0)}%`
  $('#buffer-claimable').textContent = fmtUsdc(released.toString())
}

// On-chain mode: counters come straight from Escrow.getStats(). All values
// reflect actual ERC-20 balance and `totalWithdrawn` state on Base Sepolia.
function renderBufferPanelOnChain(stats) {
  $('#escrow-mode-badge').textContent = 'on-chain Escrow'
  $('#escrow-mode-badge').className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-900/60 text-amber-200'
  $('#buf-row1-label').textContent = 'Total deposited'
  $('#buf-row2-label').textContent = 'Currently held'
  $('#buf-row3-label').textContent = 'Released to seller'
  $('#buf-row4-label').textContent = 'Withdrawable now'
  $('#buf-row5-label').classList.remove('hidden')
  $('#buffer-withdrawn').classList.remove('hidden')
  $('#escrow-foot-off').classList.add('hidden')
  $('#escrow-foot-on').classList.remove('hidden')

  $('#buffer-per-call').textContent = fmtUsdc(stats.totalDeposited.toString())
  $('#buffer-accrued').textContent  = fmtUsdc(stats.currentlyHeld.toString())
  $('#buffer-released').textContent = `${(stats.releasedBps / 100).toFixed(0)}%`
  $('#buffer-claimable').textContent = fmtUsdc(stats.withdrawableNow.toString())
  $('#buffer-withdrawn').textContent = fmtUsdc(stats.totalWithdrawn.toString())
}

function renderEnsRecords(records) {
  const tbody = $('#ens-records-table')
  if (!tbody) return
  tbody.innerHTML = ''
  const entries = Object.entries(records ?? {})
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="text-gray-600 italic py-2 text-center text-xs">no records</td></tr>'
    return
  }
  for (const [k, v] of entries) {
    const tr = document.createElement('tr')
    tr.className = 'border-t border-gray-800'
    const is0x = typeof v === 'string' && v.startsWith('0x') && v.length >= 10
    const valHtml = is0x
      ? `<a href="${CFG.BASESCAN_ADDR}${v}" target="_blank" class="text-blue-400 underline font-mono text-xs">${trunc(v, 8)}</a>`
      : `<span class="font-mono text-xs text-gray-200">${escapeHtml(v)}</span>`
    tr.innerHTML = `<td class="py-1 text-xs text-gray-400 pr-4">${escapeHtml(k)}</td><td class="py-1">${valHtml}</td>`
    tbody.appendChild(tr)
  }
}

function renderTierTable(count) {
  const tbody = $('#tier-table')
  tbody.innerHTML = ''
  const active = activeTier(count)
  for (const t of TIERS) {
    const tr = document.createElement('tr')
    const isActive = t === active
    tr.className = isActive ? 'tier-active rounded' : ''
    const pct = (t.releaseBps / 100).toFixed(0)
    tr.innerHTML = `
      <td class="py-1">${t.min}+</td>
      <td class="py-1"><span class="${t.textCls}">${t.label}</span></td>
      <td class="py-1 text-right font-mono">${pct}%</td>
    `
    tbody.appendChild(tr)
  }
}

function renderCallLog(receipts, splitterAddr) {
  const tbody = $('#calls-table')
  tbody.innerHTML = ''
  // Belt-and-suspenders client-side filter: even though the orchestrator
  // proxy already passes ?payTo=<splitter> to the facilitator, an older
  // facilitator deploy that doesn't yet honor the filter would return
  // every receipt. We filter again here so the dashboard never bleeds
  // another agent's paid calls into this view.
  let filtered = receipts || []
  if (splitterAddr && filtered.length) {
    const target = splitterAddr.toLowerCase()
    filtered = filtered.filter(r => (r.payTo ?? '').toLowerCase() === target)
  }
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-gray-600 italic py-4 text-center">no calls yet</td></tr>'
    return
  }
  for (const r of filtered) {
    const tr = document.createElement('tr')
    tr.className = 'border-t border-gray-800'
    // API returns camelCase: tx, tdErc8004Tx, paymentId, submittedAt, reconcileNotes
    const settleLink = r.tx
      ? `<a href="${CFG.BASESCAN_TX}${r.tx}" target="_blank" class="text-blue-400 underline">${trunc(r.tx, 8)}</a>`
      : '—'
    // distributeTx is embedded in reconcileNotes as "distributeTx=0x..." — parsed defensively;
    // historical receipts where the field is missing render '—'.
    const distMatch = (r.reconcileNotes || '').match(/distributeTx=(0x[a-fA-F0-9]{64})/)
    const distributeLink = distMatch
      ? `<a href="${CFG.BASESCAN_TX}${distMatch[1]}" target="_blank" class="text-amber-400 underline">${trunc(distMatch[1], 8)}</a>`
      : '—'
    const attestLink = r.tdErc8004Tx
      ? `<a href="${CFG.BASESCAN_TX}${r.tdErc8004Tx}" target="_blank" class="text-green-400 underline">${trunc(r.tdErc8004Tx, 8)}</a>`
      : '—'
    tr.innerHTML = `
      <td class="py-1 text-gray-400 text-xs">${fmtTs(r.submittedAt)}</td>
      <td class="py-1 text-gray-300 text-xs">${trunc(r.paymentId, 8)}</td>
      <td class="py-1 text-xs">${settleLink}</td>
      <td class="py-1 text-xs">${distributeLink}</td>
      <td class="py-1 text-xs">${attestLink}</td>
    `
    tbody.appendChild(tr)
  }
}

// "Run Test Call" — server-side x402 buyer flow against the agent worker's
// dynamic /:label/research route. POSTs the current dashboard's ENS to
// /demo/test-call; the orchestrator does the GET → 402 → sign → GET-with-
// header → 200 round-trip with BUYER_DEMO_1_PK and returns the receipt.
//
// We render the in-flight state inline (next to the button) and refresh
// the dashboard a few seconds after settle so the new "Recent paid call"
// row appears without waiting for the 3s heartbeat.
async function runTestCall() {
  if (!activeEns) return
  const btn      = $('#run-call-btn')
  const statusEl = $('#run-call-status')
  if (btn) { btn.disabled = true; btn.textContent = 'Settling…' }
  if (statusEl) {
    statusEl.classList.remove('hidden')
    statusEl.innerHTML = '<span class="text-gray-400">Signing EIP-3009 + waiting for Splitter.distribute…</span>'
  }
  try {
    const res = await fetch(`${CFG.ORCHESTRATOR_BASE}/demo/test-call`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ensName: activeEns, query: 'demo call from dashboard' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      const detail = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
    const txLink = body.transferTx
      ? `<a href="${CFG.BASESCAN_TX}${body.transferTx}" target="_blank" class="text-blue-400 underline">${trunc(body.transferTx, 8)}</a>`
      : '(no tx)'
    if (statusEl) {
      statusEl.innerHTML =
        `<span class="text-green-400">✓ settled:</span> ` +
        `paymentId <span class="text-gray-300">${trunc(body.paymentId, 8)}</span> · ` +
        `transfer tx ${txLink}`
    }
    // Refresh shortly so the new row + Escrow tier update land visibly.
    setTimeout(refreshDashboard, 4_000)
    setTimeout(refreshDashboard, 12_000)
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-red-400">test call failed:</span> ${escapeHtml(err?.message ?? String(err))}`
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Test Call' }
  }
}
$('#run-call-btn')?.addEventListener('click', runTestCall)

// ─── Wallet connect + claim ──────────────────────────────────────────────
// Two paths gated on the DEMO_MODE flag at the top of this file:
//
//   DEMO_MODE = false (production / canonical L4d):
//     "Connect Wallet" prompts MetaMask (or any EIP-1193 provider). The
//     connected account drives the Claim button gate against
//     IdentityRegistry.ownerOf(agentId). withdrawAll() is signed by the
//     wallet via eth_sendTransaction.
//
//   DEMO_MODE = true (current — H-9 demo mode):
//     "Connect Wallet" calls IdentityRegistry.ownerOf(agentId) directly
//     and sets connectedAddress to the result, no wallet popup. The
//     Claim button POSTs to /demo/claim, which the orchestrator signs
//     server-side using SELLER_PK from a wrangler secret. Same on-chain
//     effect (real Escrow.withdrawAll() tx, real seller EOA), no
//     MetaMask ceremony in the recording.

let connectedAddress = null

async function connectWallet() {
  if (DEMO_MODE) return connectWalletDemo()

  const eth = /** @type {any} */ (window).ethereum
  if (!eth) {
    alert('No EIP-1193 wallet detected. Install MetaMask, Rabby, or similar to claim.')
    return
  }
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' })
    connectedAddress = accounts?.[0]?.toLowerCase() ?? null
    try {
      const cur = await eth.request({ method: 'eth_chainId' })
      if (cur !== BASE_SEPOLIA_CHAIN_ID_HEX) {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
        })
      }
    } catch (err) {
      if (err?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId:           BASE_SEPOLIA_CHAIN_ID_HEX,
            chainName:         'Base Sepolia',
            nativeCurrency:    { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls:           ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
          }],
        })
      } else {
        console.error('chain switch failed', err)
      }
    }

    eth.on?.('accountsChanged', (accts) => {
      connectedAddress = accts?.[0]?.toLowerCase() ?? null
      refreshClaimGate()
    })
    eth.on?.('chainChanged', () => refreshClaimGate())
  } catch (err) {
    console.error('wallet connect failed', err)
    alert(`Wallet connect failed: ${err?.message ?? err}`)
    return
  }
  await refreshClaimGate()
}

// Demo-mode connect: read the agent NFT owner from on-chain and pretend
// we're "connected" as that wallet. No popup, no chain switch, no event
// subscriptions. The Claim button still gates on connectedAddress ===
// nftOwner, so this can only succeed when the dashboard's agent NFT is
// owned by the seller EOA whose key the orchestrator holds — which is
// the L4d invariant after step 6 transfers ENS ownership to the seller.
async function connectWalletDemo() {
  const btn = $('#wallet-connect-btn')
  if (!agentIdCached) {
    if (btn) {
      const original = btn.textContent
      btn.textContent = 'Loading agent…'
      setTimeout(() => { if (btn.textContent === 'Loading agent…') btn.textContent = original }, 1500)
    }
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…' }
  try {
    connectedAddress = await readNftOwner(
      CFG.BASE_SEPOLIA_RPC,
      IDENTITY_REGISTRY_BASE_SEPOLIA,
      agentIdCached,
    )
  } catch (err) {
    console.error('demo connect: ownerOf failed', err)
    if (btn) { btn.disabled = false; btn.textContent = 'Connect Wallet' }
    alert(`Demo connect failed: ${err?.message ?? err}`)
    return
  }
  await refreshClaimGate()
}

// Re-evaluate the Claim row + wallet status row visibility.
//
// Rendering policy (intentionally always-visible when an Escrow exists, so
// the Claim affordance is discoverable in screenshots and the demo video
// even before MetaMask is connected):
//
//   No Escrow on this agent (legacy / pre-L4d agents)
//     → claim row hidden entirely.
//
//   Escrow exists, no wallet connected
//     → row visible, amount populated from getStats(), button disabled with
//       hint "Connect wallet to claim". Owner flag tells the user which
//       wallet they need to connect (NFT owner address).
//
//   Escrow exists, wallet connected, wrong owner
//     → row visible, amount populated, button disabled with hint
//       "Wrong wallet (owner: 0x…)".
//
//   Escrow exists, wallet connected, correct owner, nothing to claim
//     → row visible, amount = 0, button disabled with hint "Nothing to claim".
//
//   Escrow exists, wallet connected, correct owner, claimable > 0
//     → row visible, amount > 0, button enabled with text "Claim All".
async function refreshClaimGate() {
  const btn        = $('#wallet-connect-btn')
  const statusRow  = $('#wallet-status')
  const ownerFlag  = $('#wallet-owner-flag')
  const claimRow   = $('#claim-row')
  const claimBtn   = $('#claim-btn')
  const claimAmt   = $('#claim-amount')
  const claimTo    = $('#claim-to')
  if (!btn) return

  // Wallet-connect button + status row are wallet-driven, not Escrow-driven.
  if (!connectedAddress) {
    btn.textContent = 'Connect Wallet'
    btn.disabled = false
    statusRow?.classList.add('hidden')
  } else {
    btn.textContent = trunc(connectedAddress)
    btn.disabled = true
    statusRow?.classList.remove('hidden')
    $('#wallet-address').textContent = connectedAddress
  }

  // No Escrow on this agent → hide the claim affordance entirely.
  if (!escrowAddrCached || !agentIdCached) {
    if (ownerFlag && connectedAddress) {
      ownerFlag.innerHTML = '<span class="text-gray-600">(no on-chain Escrow on this agent)</span>'
    }
    claimRow?.classList.add('hidden')
    return
  }

  // Escrow exists → ALWAYS show the row. Populate amount from the latest
  // getStats() snapshot (independent of wallet state).
  claimRow?.classList.remove('hidden')
  const w = escrowSnapshot?.withdrawableNow ?? 0n
  claimAmt.textContent = fmtUsdc(w.toString())

  // Look up the NFT owner once — drives the "to" address shown in the row
  // even before the user connects, so they know which wallet to use.
  let nftOwner = null
  try {
    nftOwner = await readNftOwner(CFG.BASE_SEPOLIA_RPC, IDENTITY_REGISTRY_BASE_SEPOLIA, agentIdCached)
  } catch (err) {
    console.error('readNftOwner failed', err)
  }

  // No wallet → preview state.
  if (!connectedAddress) {
    claimTo.textContent = nftOwner ? trunc(nftOwner) : '(connect wallet)'
    if (claimBtn) {
      claimBtn.disabled = true
      claimBtn.textContent = 'Connect wallet to claim'
    }
    return
  }

  // Wallet connected → owner check drives button state.
  if (!nftOwner) {
    if (ownerFlag) ownerFlag.innerHTML = '<span class="text-red-400">(owner check failed)</span>'
    claimTo.textContent = trunc(connectedAddress)
    if (claimBtn) {
      claimBtn.disabled = true
      claimBtn.textContent = 'Owner check failed'
    }
    return
  }

  if (nftOwner === connectedAddress) {
    if (ownerFlag) ownerFlag.innerHTML = '<span class="text-green-400">✓ owner of agent NFT — can claim</span>'
    claimTo.textContent = trunc(connectedAddress)
    if (claimBtn) {
      claimBtn.disabled = (w === 0n)
      claimBtn.textContent = w === 0n ? 'Nothing to claim' : 'Claim All'
    }
  } else {
    if (ownerFlag) ownerFlag.innerHTML = `<span class="text-amber-300">connected wallet is not the agent NFT owner (${trunc(nftOwner)})</span>`
    claimTo.textContent = trunc(nftOwner)
    if (claimBtn) {
      claimBtn.disabled = true
      claimBtn.textContent = 'Wrong wallet'
    }
  }
}

async function claimAll() {
  if (!escrowAddrCached || !connectedAddress) return
  const statusEl = $('#claim-status')
  statusEl?.classList.remove('hidden')
  statusEl.innerHTML = '<span class="text-gray-400">submitting tx…</span>'

  try {
    let txHash
    if (DEMO_MODE) {
      // Server-side broadcast via SELLER_PK. The orchestrator validates
      // the escrow address shape and returns 502 on a viem broadcast
      // error; we surface the upstream detail string verbatim.
      const res = await fetch(`${CFG.ORCHESTRATOR_BASE}/demo/claim`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ escrowAddress: escrowAddrCached }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) {
        throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`)
      }
      txHash = body.txHash
    } else {
      const eth = /** @type {any} */ (window).ethereum
      if (!eth) return
      txHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{
          from: connectedAddress,
          to:   escrowAddrCached,
          data: SEL.withdrawAll,
        }],
      })
    }
    statusEl.innerHTML =
      `<span class="text-green-400">✓ tx submitted:</span> ` +
      `<a href="${CFG.BASESCAN_TX}${txHash}" target="_blank" class="text-blue-400 underline">${trunc(txHash, 8)}</a>`
    setTimeout(refreshDashboard, 4_000)
  } catch (err) {
    statusEl.innerHTML = `<span class="text-red-400">claim failed:</span> ${escapeHtml(err?.message ?? String(err))}`
  }
}

$('#wallet-connect-btn')?.addEventListener('click', connectWallet)
$('#claim-btn')?.addEventListener('click', claimAll)

// ─── Boot ─────────────────────────────────────────────────────────────────
route()
