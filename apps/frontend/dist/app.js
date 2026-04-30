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
}

const TIERS = [
  { min: 0,  label: 'base (no discount)',  discountBps: 0,    bgCls: 'bg-gray-700',   textCls: 'text-gray-300' },
  { min: 1,  label: 'bronze (5% off)',     discountBps: 500,  bgCls: 'bg-amber-700',  textCls: 'text-amber-200' },
  { min: 3,  label: 'silver (10% off)',    discountBps: 1000, bgCls: 'bg-gray-500',   textCls: 'text-gray-100' },
  { min: 10, label: 'gold (15% off)',      discountBps: 1500, bgCls: 'bg-yellow-600', textCls: 'text-yellow-100' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel) }
function $$(sel) { return [...document.querySelectorAll(sel)] }
function html(s) { return s }
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

// ─── Routing (hash-based) ─────────────────────────────────────────────────
function activate(viewId, data) {
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
  activeEns = ens
  $('#dashboard-ens').textContent = ens
  $('#terminal-url').textContent =
    `${new URL(CFG.GATEWAY_BASE).host}/lookup/${ens}/x402.amount?backend=erc8004`
  stopDashboard()
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
    // Fetch records via the agent_id index proxy. The gateway's static
    // backend exposes raw records via POST /lookup with CCIP-Read encoding,
    // which is a lot for a vanilla frontend — we fall back to a helper
    // endpoint (/records/:ensName) if available, otherwise just show "—".
    //
    // For the demo we rely on the facilitator's receipts admin endpoint
    // filtered client-side by our known ENS name. The receipts don't carry
    // the ENS name today, so we display all recent receipts when only one
    // SellingAgent is onboarded (the demo case per demo_narrative.md).
    const [amountRes, receiptsRes] = await Promise.all([
      fetchAmount(activeEns),
      fetchRecentReceipts(),
    ])
    renderDashboardHeader(amountRes)
    renderTerminalPane(amountRes)
    renderCallLog(receiptsRes)

    // Trust count: use receipt count as proxy (each CONFIRMED receipt with
    // td_erc8004_tx is an attestation).
    const attestationCount = (receiptsRes ?? []).filter(r => r.td_erc8004_tx).length
    $('#trust-count').textContent = String(attestationCount)
    const tier = activeTier(attestationCount)
    const badge = $('#trust-badge')
    badge.className = `ml-auto px-3 py-1 rounded text-xs font-bold ${tier.bgCls} ${tier.textCls}`
    badge.textContent = tier.label
    renderTierTable(amountRes.baseAmount ?? '100000', attestationCount)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('dashboard refresh failed', err)
  }
}

async function fetchAmount(ens) {
  try {
    const url = `${CFG.GATEWAY_BASE}/records/${encodeURIComponent(ens)}?flat=true&backend=erc8004`
    const res = await fetch(url)
    if (!res.ok) return { baseAmount: null, currentAmount: null }
    const body = await res.json()
    const records = body?.records ?? {}
    const amount = records['x402.amount'] ?? null
    return { baseAmount: amount, currentAmount: amount }
  } catch {
    return { baseAmount: null, currentAmount: null }
  }
}

async function fetchRecentReceipts() {
  try {
    const res = await fetch(`${CFG.FACILITATOR_BASE}/admin/receipts?limit=20`)
    if (!res.ok) return []
    const body = await res.json()
    return Array.isArray(body?.receipts) ? body.receipts : []
  } catch {
    return []
  }
}

function renderDashboardHeader(amount) {
  const price = amount.currentAmount ?? amount.baseAmount ?? null
  $('#dash-current-price').textContent = price !== null ? fmtUsdc(price) : '—'
  // splitter/agentId/owner show up when the orchestrator surfaces them via /agent/:ens
  $('#dash-endpoint').textContent = '—'
  $('#dash-splitter').textContent = '—'
  $('#dash-agent-id').textContent = '—'
  $('#dash-owner').textContent = '—'
}

function renderTerminalPane(amount) {
  const out = amount.currentAmount ?? amount.baseAmount ?? '100000'
  $('#terminal-output').textContent = JSON.stringify({ value: out }, null, 2)
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
    const settleLink = r.transaction ? `<a href="${CFG.BASESCAN_TX}${r.transaction}" target="_blank" class="text-blue-400 underline">${trunc(r.transaction, 8)}</a>` : '—'
    const attestLink = r.td_erc8004_tx ? `<a href="${CFG.BASESCAN_TX}${r.td_erc8004_tx}" target="_blank" class="text-green-400 underline">${trunc(r.td_erc8004_tx, 8)}</a>` : '—'
    tr.innerHTML = `
      <td class="py-1 text-gray-400 text-xs">${fmtTs(r.submitted_at)}</td>
      <td class="py-1 text-gray-300 text-xs">${trunc(r.paymentId ?? r.payment_id, 8)}</td>
      <td class="py-1 text-xs">${settleLink}</td>
      <td class="py-1 text-xs">${attestLink}</td>
    `
    tbody.appendChild(tr)
  }
}

// Run Test Call button — delegates to the same paid-call flow that full-flow-l4b
// exercises. For the hackathon we open a new tab to the agent endpoint; a
// browser-side buyer-sdk integration is Spec 08B Q-08B-1's forward-compat hook.
$('#run-call-btn')?.addEventListener('click', () => {
  if (!activeEns) return
  const msg = `To run a paid call against ${activeEns}, run this from your shell:\n\n` +
    `bash tools/integration-tests/full-flow-l4b.sh --merchant ${activeEns}\n\n` +
    `Settlement + attestation txs will appear in the call log below within ~15s.`
  alert(msg)
})

// ─── Boot ─────────────────────────────────────────────────────────────────
route()
