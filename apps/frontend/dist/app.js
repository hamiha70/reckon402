// Reckon402 L4c frontend — vanilla module, no bundler.
// Served at the same origin as the onboard-orchestrator worker so all fetches
// are relative paths (no CORS configuration).

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
  // Populated after KeeperHub workflow is published (Phase 3C)
  KH_WORKFLOW_URL:   'https://app.keeperhub.run/workflow/reckon402-research',
}

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

// ─── Routing (hash-based) ─────────────────────────────────────────────────
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
      activate('view-dashboard')
      startDashboard(ens)
      return
    }
  }
  activate('view-onboard')
  stopDashboard()
}
window.addEventListener('hashchange', route)

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

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(form)
  const label     = String(fd.get('label')     ?? '')
  const sellerEoa = String(fd.get('sellerEoa') ?? '')
  const endpoint  = String(fd.get('endpoint')  ?? '')
  const amountInput = String(fd.get('amount')  ?? '')
  const name = `${label}.${CFG.PARENT_ENS}`

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

  // 3-recipient Splitter: seller / facilitator+deployer fee / risk-buffer escrow.
  // The factory enforces recipients[0] === sellerEoa; we mirror that here so a
  // mismatch fails fast in the browser.
  const recipients = [sellerEoa, FACILITATOR_EOA, RISK_BUFFER_EOA]
  const bps        = [SELLER_BPS, FACILITATOR_BPS, RISK_BUFFER_BPS]

  let res
  try {
    res = await fetch(`${CFG.ORCHESTRATOR_BASE}/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sellerEoa, endpoint, amount: amountAtomic, recipients, bps }),
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

function renderSteps(el, steps) {
  const labels = {
    1: 'Mint ENS subname',
    2: 'Deploy Splitter via factory',
    3: 'Register ERC-8004 agentId',
    4: 'Set ENS records (gateway bootstrap)',
    5: 'Seed gateway + transfer ENS ownership',
  }
  el.innerHTML = ''
  for (const id of [1, 2, 3, 4, 5]) {
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

// Reveals the agent-mint result card once step 3 completes with a `note` of
// the form `agentId=<n>`. The orchestrator emits this annotation in step 3's
// end-event (see tools/onboard/src/orchestrator.ts). Owner address comes from
// the form submission stashed in `pendingOnboard`.
function renderAgentMintCard(steps) {
  const cardEl = $('#agent-mint-card')
  if (!cardEl) return
  const step3 = steps.find(s => s.id === 3)
  if (!step3 || !step3.note || !pendingOnboard) return
  const m = step3.note.match(/^agentId=(\d+)$/)
  if (!m) return

  const agentId = m[1]
  $('#mint-agent-id').textContent = `#${agentId}`
  $('#mint-owner').textContent = pendingOnboard.sellerEoa
  const txEl = $('#mint-tx')
  if (step3.txHash && txEl) {
    txEl.innerHTML = `<a href="${CFG.BASESCAN_TX}${step3.txHash}" target="_blank" class="text-blue-400 underline">${trunc(step3.txHash, 8)}</a>`
  } else if (txEl) {
    txEl.textContent = '—'
  }
  cardEl.classList.remove('hidden')
}

// ─── Dashboard ────────────────────────────────────────────────────────────
let dashboardTimer = null
let activeEns = null

function startDashboard(ens) {
  stopDashboard()
  activeEns = ens
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
    const [recordsRes, receiptsRes] = await Promise.all([
      fetchRecords(activeEns),
      fetchRecentReceipts(),
    ])
    renderDashboardHeader(recordsRes)
    renderTerminalPane(recordsRes)
    renderEnsRecords(recordsRes.allRecords)
    renderCallLog(receiptsRes)

    // Attestation count = receipts that landed an ERC-8004 NewFeedback tx.
    const attestationCount = (receiptsRes ?? []).filter(r => r.tdErc8004Tx).length
    $('#trust-count').textContent = String(attestationCount)
    const tier = activeTier(attestationCount)
    const badge = $('#trust-badge')
    badge.className = `ml-auto px-3 py-1 rounded text-xs font-bold ${tier.bgCls} ${tier.textCls}`
    badge.textContent = tier.label

    renderBufferPanel(recordsRes.baseAmount, attestationCount, tier)
    renderTierTable(attestationCount)
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
      agentId:   records['x402.erc8004.agent_id'] ?? null,
      endpoint:  records['x402.endpoint'] ?? null,
    }
  } catch {
    return { baseAmount: null, allRecords: {} }
  }
}

// Receipts are fetched via the orchestrator proxy (/receipts) which adds
// server-side Bearer auth. The frontend never sees the ADMIN_TOKEN.
async function fetchRecentReceipts() {
  try {
    const res = await fetch(`${CFG.ORCHESTRATOR_BASE}/receipts?limit=20`)
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

  $('#dash-agent-id').textContent = r.agentId ?? '—'
  $('#dash-owner').textContent = '—'  // not returned by flat-records; populated if needed
}

function renderTerminalPane(r) {
  const out = r.baseAmount ?? '100000'
  const snippet = { records: { 'x402.amount': out } }
  if (r.splitter) snippet.records['x402.splitter'] = r.splitter
  if (r.agentId)  snippet.records['x402.erc8004.agent_id'] = r.agentId
  $('#terminal-output').textContent = JSON.stringify(snippet, null, 2)
}

// Risk-buffer accounting: every settlement deposits `bufferPerCallAtomic` into
// the on-chain risk-buffer EOA. The seller's "claimable" balance is the
// accrued total times the current tier's release fraction.
function renderBufferPanel(baseAmount, attestationCount, tier) {
  const baseAtomic = baseAmount ?? '100000'
  const perCall   = bufferPerCallAtomic(baseAtomic)
  const accrued   = perCall * BigInt(attestationCount)
  const released  = releasedAtomic(accrued, tier)
  $('#buffer-per-call').textContent = fmtUsdc(perCall.toString())
  $('#buffer-accrued').textContent  = fmtUsdc(accrued.toString())
  $('#buffer-released').textContent = `${(tier.releaseBps / 100).toFixed(0)}%`
  $('#buffer-claimable').textContent = fmtUsdc(released.toString())
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

function renderCallLog(receipts) {
  const tbody = $('#calls-table')
  tbody.innerHTML = ''
  if (!receipts || !receipts.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-gray-600 italic py-4 text-center">no calls yet</td></tr>'
    return
  }
  for (const r of receipts) {
    const tr = document.createElement('tr')
    tr.className = 'border-t border-gray-800'
    // API returns camelCase: tx, tdErc8004Tx, paymentId, submittedAt
    const settleLink = r.tx
      ? `<a href="${CFG.BASESCAN_TX}${r.tx}" target="_blank" class="text-blue-400 underline">${trunc(r.tx, 8)}</a>`
      : '—'
    const attestLink = r.tdErc8004Tx
      ? `<a href="${CFG.BASESCAN_TX}${r.tdErc8004Tx}" target="_blank" class="text-green-400 underline">${trunc(r.tdErc8004Tx, 8)}</a>`
      : '—'
    tr.innerHTML = `
      <td class="py-1 text-gray-400 text-xs">${fmtTs(r.submittedAt)}</td>
      <td class="py-1 text-gray-300 text-xs">${trunc(r.paymentId, 8)}</td>
      <td class="py-1 text-xs">${settleLink}</td>
      <td class="py-1 text-xs">${attestLink}</td>
    `
    tbody.appendChild(tr)
  }
}

// "Run Test Call" opens the KeeperHub workflow in a new tab.
$('#run-call-btn')?.addEventListener('click', () => {
  window.open(CFG.KH_WORKFLOW_URL, '_blank')
})

// ─── Boot ─────────────────────────────────────────────────────────────────
route()
