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

const TIERS = [
  { min: 0,  label: 'base (no discount)',  discountBps: 0,    bgCls: 'bg-gray-700',   textCls: 'text-gray-300' },
  { min: 1,  label: 'bronze (5% off)',     discountBps: 500,  bgCls: 'bg-amber-700',  textCls: 'text-amber-200' },
  { min: 3,  label: 'silver (10% off)',    discountBps: 1000, bgCls: 'bg-gray-500',   textCls: 'text-gray-100' },
  { min: 10, label: 'gold (15% off)',      discountBps: 1500, bgCls: 'bg-yellow-600', textCls: 'text-yellow-100' },
]

// Hardcoded BPS split (matches SplitterFactory deploy args for demo SellingAgent)
const SPLIT_DISPLAY = [
  { label: '0xD53f… (seller)',    bps: 9700 },
  { label: '0x0A02… (platform)',  bps: 200 },
  { label: '0x66C2… (deployer)',  bps: 100 },
]

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
function priceAt(baseAmount, tier) {
  const n = BigInt(baseAmount)
  return ((n * BigInt(10_000 - tier.discountBps)) / 10_000n).toString()
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

if (labelInput && ensPreview) {
  labelInput.addEventListener('input', () => {
    ensPreview.textContent = `${labelInput.value || 'seller?'}.${CFG.PARENT_ENS}`
  })
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(form)
  const label = String(fd.get('label') ?? '')
  const sellerEoa = String(fd.get('sellerEoa') ?? '')
  const endpoint = String(fd.get('endpoint') ?? '')
  const amount = String(fd.get('amount') ?? '')
  const name = `${label}.${CFG.PARENT_ENS}`

  const panel = $('#progress-panel')
  panel.classList.remove('hidden')
  const stepsList = $('#progress-steps')
  stepsList.innerHTML = '<li class="text-gray-500">submitting…</li>'

  let res
  try {
    res = await fetch(`${CFG.ORCHESTRATOR_BASE}/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sellerEoa, endpoint, amount }),
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
      setTimeout(() => {
        location.hash = `#/agent/${encodeURIComponent(ensName)}`
      }, 500)
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
    const link = step?.externalLink
      ? ` — <a href="${step.externalLink}" target="_blank" class="text-blue-400 underline hover:text-blue-300">${trunc(step.txHash ?? step.externalLink, 8)}</a>`
      : ''
    li.innerHTML = `<span class="${cls} w-6 text-center font-bold">${icon}</span>
                    <span class="${cls}">${labels[id]}</span>
                    <span class="text-xs text-gray-600 ml-auto">${link}</span>`
    el.appendChild(li)
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────
let dashboardTimer = null
let activeEns = null

function startDashboard(ens) {
  stopDashboard()
  activeEns = ens
  $('#dashboard-ens').textContent = ens
  $('#terminal-url').textContent =
    `${new URL(CFG.GATEWAY_BASE).host}/records/${ens}?flat=true&backend=erc8004`
  renderTierTable('100000', 0)
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

    // Trust count: receipts with tdErc8004Tx are confirmed attestations
    const attestationCount = (receiptsRes ?? []).filter(r => r.tdErc8004Tx).length
    $('#trust-count').textContent = String(attestationCount)
    const tier = activeTier(attestationCount)
    const badge = $('#trust-badge')
    badge.className = `ml-auto px-3 py-1 rounded text-xs font-bold ${tier.bgCls} ${tier.textCls}`
    badge.textContent = tier.label
    renderTierTable(recordsRes.baseAmount ?? '100000', attestationCount)
  } catch (err) {
    console.error('dashboard refresh failed', err)
  }
}

async function fetchRecords(ens) {
  try {
    const url = `${CFG.GATEWAY_BASE}/records/${encodeURIComponent(ens)}?flat=true&backend=erc8004`
    const res = await fetch(url)
    if (!res.ok) return { baseAmount: null, currentAmount: null, allRecords: {} }
    const body = await res.json()
    const records = body?.records ?? {}
    const amount = records['x402.amount'] ?? null
    return {
      baseAmount: amount,
      currentAmount: amount,
      allRecords: records,
      splitter:  records['x402.splitter'] ?? null,
      agentId:   records['x402.erc8004.agent_id'] ?? null,
      endpoint:  records['x402.endpoint'] ?? null,
    }
  } catch {
    return { baseAmount: null, currentAmount: null, allRecords: {} }
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
  const price = r.currentAmount ?? r.baseAmount ?? null
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
  const out = r.currentAmount ?? r.baseAmount ?? '100000'
  const snippet = { records: { 'x402.amount': out } }
  if (r.splitter) snippet.records['x402.splitter'] = r.splitter
  if (r.agentId)  snippet.records['x402.erc8004.agent_id'] = r.agentId
  $('#terminal-output').textContent = JSON.stringify(snippet, null, 2)
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

function renderTierTable(baseAmount, count) {
  const tbody = $('#tier-table')
  tbody.innerHTML = ''
  const active = activeTier(count)
  for (const t of TIERS) {
    const tr = document.createElement('tr')
    const isActive = t === active
    tr.className = isActive ? 'tier-active rounded' : ''
    tr.innerHTML = `
      <td class="py-1">${t.min}+</td>
      <td class="py-1"><span class="${t.textCls}">${t.label}</span></td>
      <td class="py-1 text-right">${fmtUsdc(priceAt(baseAmount, t))}</td>
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
