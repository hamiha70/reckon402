import { Hono, type Context } from 'hono'
import { runOnboard, type OnboardArgs, type OnboardEnv, type OnboardStep } from '@reckon402/onboard'
import type { Env } from './env.js'
import { ProgressStore, generateOnboardId } from './progress-store.js'

const app = new Hono<{ Bindings: Env }>()

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

app.options('/onboard',              (c) => new Response(null, { status: 204, headers: CORS }))
app.options('/onboard/*',            (c) => new Response(null, { status: 204, headers: CORS }))

app.get('/healthz', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ ok: true }, 200, CORS)
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 503, CORS)
  }
})

interface OnboardRequest {
  name?: unknown; sellerEoa?: unknown; endpoint?: unknown; amount?: unknown
  recipients?: unknown; bps?: unknown
  /**
   * L4d on-chain Escrow flag. When true, the orchestrator runs the 6-step
   * flow (mint → agentId → escrow → 3-recipient splitter → ENS records →
   * gateway seed). When false / absent, the legacy 5-step flow runs.
   * Requires ESCROW_FACTORY_ADDRESS / TIER_STRATEGY_ADDRESS /
   * FACILITATOR_FEE_EOA to be configured on the worker.
   */
  enableL4dEscrow?: unknown
}

app.post('/onboard', async (c) => {
  let body: OnboardRequest
  try { body = (await c.req.json()) as OnboardRequest } catch {
    return c.json({ error: 'malformed_json' }, 400, CORS)
  }

  const name      = typeof body.name      === 'string' ? body.name : ''
  const sellerEoa = typeof body.sellerEoa === 'string' ? body.sellerEoa as `0x${string}` : ''
  const endpoint  = typeof body.endpoint  === 'string' ? body.endpoint : ''
  const amount    = typeof body.amount    === 'string' ? body.amount : ''
  const recipients = Array.isArray(body.recipients)
    ? body.recipients.filter(r => typeof r === 'string') as `0x${string}`[]
    : undefined
  const bps = Array.isArray(body.bps)
    ? body.bps.filter(b => typeof b === 'number') as number[]
    : undefined
  const enableL4dEscrow = body.enableL4dEscrow === true

  // Fast-fail if the request asks for L4d but the worker isn't configured.
  // The orchestrator would throw the same error one step later, but failing
  // here keeps the error surface in the HTTP response rather than burying it
  // in onboard_progress.error.
  if (enableL4dEscrow && (
    !c.env.ESCROW_FACTORY_ADDRESS ||
    !c.env.TIER_STRATEGY_ADDRESS  ||
    !c.env.FACILITATOR_FEE_EOA
  )) {
    return c.json({
      error: 'l4d_not_configured',
      detail: 'enableL4dEscrow=true requires ESCROW_FACTORY_ADDRESS, ' +
              'TIER_STRATEGY_ADDRESS, and FACILITATOR_FEE_EOA to be set on the worker',
    }, 503, CORS)
  }

  if (!name || !sellerEoa || !endpoint || !amount) {
    return c.json({ error: 'missing_required_field' }, 422, CORS)
  }
  const parts = name.split('.')
  if (parts.length < 3) {
    return c.json({ error: 'malformed_ens_name' }, 422, CORS)
  }
  const label      = parts[0]!
  const parentName = parts.slice(1).join('.')

  const onboardId = generateOnboardId()
  const store = new ProgressStore(c.env.DB)
  await store.create(onboardId, name, sellerEoa)

  // Build orchestrator env. Per spec Q-08B-5, we don't block on chain ops in
  // the request handler — ctx.waitUntil lets the orchestrator run for up to
  // 30s post-response.
  const onboardEnv: OnboardEnv = {
    ETH_SEPOLIA_RPC_PRIMARY:  c.env.ETH_SEPOLIA_RPC_PRIMARY,
    BASE_SEPOLIA_RPC_PRIMARY: c.env.BASE_SEPOLIA_RPC_PRIMARY,
    ENS_FUNDER_PK:            c.env.ENS_FUNDER_PK            as `0x${string}`,
    RECKON402_DEPLOYER_PK:    c.env.RECKON402_DEPLOYER_PK    as `0x${string}`,
    RECKON402_ONBOARDING_PK:  c.env.RECKON402_ONBOARDING_PK  as `0x${string}`,
    SPLITTER_FACTORY_ADDRESS: c.env.SPLITTER_FACTORY_ADDRESS as `0x${string}`,
    RECKON402_RESOLVER_SEPOLIA: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
    IDENTITY_REGISTRY_BASE_SEPOLIA: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    ESCROW_FACTORY_ADDRESS:   c.env.ESCROW_FACTORY_ADDRESS as `0x${string}` | undefined,
    TIER_STRATEGY_ADDRESS:    c.env.TIER_STRATEGY_ADDRESS  as `0x${string}` | undefined,
    FACILITATOR_FEE_EOA:      c.env.FACILITATOR_FEE_EOA    as `0x${string}` | undefined,
    GATEWAY_BASE_URL:         c.env.GATEWAY_BASE_URL,
    FACILITATOR_BASE_URL:     c.env.FACILITATOR_BASE_URL,
    CHAIN_ID_BASE_SEPOLIA:    84532,
  }

  const args: OnboardArgs = {
    name, parentName, label, sellerEoa, endpoint, amount, recipients, bps,
    enableL4dEscrow,
    progressSink: async (step: OnboardStep) => {
      try { await store.recordStep(onboardId, step) } catch { /* swallow */ }
    },
  }

  // Fire-and-forget via waitUntil. The handler returns {onboardId} immediately
  // so the frontend can start polling /onboard/:id/status.
  const work = (async () => {
    try {
      const result = await runOnboard(onboardEnv, args)
      await store.complete(onboardId, result)
    } catch (err) {
      await store.fail(onboardId, (err as Error).message)
    }
  })()
  // Use executionCtx.waitUntil when available, otherwise just leave the
  // promise detached (the runtime will still wait for it to resolve if the
  // worker stays alive for the invocation).
  const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined
  if (ctx?.waitUntil) ctx.waitUntil(work)

  return c.json({ onboardId, ensName: name }, 202, CORS)
})

// Receipts proxy: forwards to facilitator /admin/receipts with server-side Bearer
// auth so ADMIN_TOKEN stays secret (never sent to the browser).
app.options('/receipts', (c) => new Response(null, { status: 204, headers: CORS }))
app.get('/receipts', async (c) => {
  const limit = c.req.query('limit') ?? '20'
  const url = `${c.env.FACILITATOR_BASE_URL}/admin/receipts?limit=${encodeURIComponent(limit)}`
  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${c.env.FACILITATOR_ADMIN_TOKEN}` },
    })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (err) {
    return c.json({ error: 'receipts_fetch_failed', detail: (err as Error).message }, 502, CORS)
  }
})

app.get('/onboard/:id/status', async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return c.json({ error: 'malformed_onboard_id' }, 422, CORS)
  }
  const store = new ProgressStore(c.env.DB)
  const progress = await store.get(id)
  if (!progress) {
    return c.json({ error: 'not_found' }, 404, CORS)
  }
  return c.json(progress, 200, CORS)
})

// Fall-through: if Workers Assets is bound, let it serve static files. This
// is how the single-page frontend gets served from the same origin as the
// API — no CORS, no CNAME. Hono has no built-in ASSETS integration; we hand
// off the raw Request.
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.json({ error: 'not_found' }, 404, CORS)
})

export default {
  fetch: app.fetch,
}
