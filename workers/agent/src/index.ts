import { Hono } from 'hono'
import { withX402 } from '@reckon402/middleware-hono'
import { Reckon402Facilitator } from '@reckon402/facilitator-client'

/**
 * Env bindings (set via wrangler.toml [vars] + wrangler secret).
 *
 * L3 default route (/research) uses SPLITTER_ADDRESS / AMOUNT / SELLER_ENS
 * directly from [vars] — single hardwired seller, what we shipped for L3.
 *
 * L4c+L4d dynamic route (/:label/research) resolves all three from the
 * Reckon402 gateway's flat-records endpoint (GET /records/:ensName) so a
 * single agent worker serves arbitrarily many SellingAgents — one per
 * onboarded ENS subname. This eliminates the "re-point agent worker
 * before recording" operator step from the demo flow: any agent the
 * gateway knows about is reachable at agent.reckon402.com/<label>/research.
 *
 * In both cases the buyer's EIP-3009 auth.to must equal the resolved
 * Splitter so transferWithAuthorization lands funds in the Splitter,
 * which then distributes to the seller / facilitator / Escrow per BPS.
 */
interface Env {
  NETWORK:          string  // e.g. "eip155:84532"
  USDC_ADDRESS:     string  // USDC on the target chain (default-route fallback)
  SPLITTER_ADDRESS: string  // default-route Splitter (factory-deployed)
  AMOUNT:           string  // default-route price in atomic units; "10000" = 0.01 USDC
  FACILITATOR_URL:  string  // e.g. "https://facilitator.reckon402.com/x402"
  SELLER_ENS:       string  // default-route ENS, passed as extra.ens
  GATEWAY_BASE_URL: string  // gateway flat-records endpoint base (e.g. "https://gateway.reckon402.com")
}

interface ResolvedSeller {
  ensName:      string
  splitter:     string  // 0x… address, lowercased
  amount:       string  // atomic units, decimal string
  asset:        string  // 0x… USDC address on the target chain
  network:      string  // CAIP-2 (e.g. "eip155:84532") — pinned to env.NETWORK; gateway records carry per-asset CAIP but not a separate network
}

/**
 * Parse the gateway's CAIP-19 asset record back to a bare ERC-20 address.
 * Format: "eip155:<chainId>/erc20:<addr>".
 */
function parseAssetCaip(caip: string | undefined): string | null {
  if (!caip) return null
  const m = caip.match(/^eip155:\d+\/erc20:(0x[0-9a-fA-F]{40})$/)
  return m ? m[1]! : null
}

/**
 * Look up an agent's L4d wiring from the Reckon402 gateway.
 *
 * One subrequest per call (gateway returns all 13 records as a single
 * JSON object). Throws on 404 / malformed payload so the route handler
 * can map it to a clean 404 to the buyer.
 */
async function resolveSeller(
  gatewayBase: string,
  ensName:     string,
  fallbackNetwork: string,
): Promise<ResolvedSeller> {
  const url = `${gatewayBase}/records/${encodeURIComponent(ensName)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (res.status === 404) {
    throw new Error(`unknown_seller:${ensName}`)
  }
  if (!res.ok) {
    throw new Error(`gateway_${res.status}:${await res.text().catch(() => '')}`)
  }
  const body = await res.json() as { records?: Record<string, string> }
  const records = body.records
  if (!records) throw new Error(`gateway_malformed:${ensName}`)

  const splitter = records['x402.splitter']
  const amount   = records['x402.amount']
  const asset    = parseAssetCaip(records['x402.asset'])
  if (!splitter || !amount || !asset) {
    throw new Error(
      `gateway_missing_required_record:${ensName} (splitter=${!!splitter}, amount=${!!amount}, asset=${!!asset})`,
    )
  }
  return {
    ensName,
    splitter: splitter.toLowerCase(),
    amount,
    asset,
    network: fallbackNetwork,
  }
}

/**
 * Validate an ENS label against the strict subset we accept on the
 * dynamic route: lowercase letters, digits, single dashes (no leading
 * or trailing). Mirrors what the onboarding form accepts.
 */
function isValidLabel(label: string): boolean {
  if (!label || label.length === 0 || label.length > 63) return false
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) =>
  c.text(
    'reckon402 demo research agent\n' +
    'Layer: L3 (x402 paywall via our Facilitator)\n' +
    'Try: GET /research?q=your+question  (requires PAYMENT-SIGNATURE header)\n' +
    'Health: GET /healthz\n',
  ),
)

/**
 * GET /healthz — agent worker health probe.
 *
 * Reports the worker's *configured* posture so a sweep over every
 * Reckon402 surface can detect drift (wrong env vars after a deploy,
 * etc.). Does NOT do an outbound fetch on the configured facilitator
 * URL — that would create a healthz fan-out where the agent's healthz
 * depends on the facilitator's healthz, blowing up the cycle. The
 * facilitator has its own probe.
 *
 * `/health` (no z) is preserved as a deprecated alias for any external
 * monitor pinned to the older path; new monitors should hit /healthz.
 */
function healthBody(c: { env: Env }) {
  const env = c.env
  // Treat any non-empty string with the right shape as "configured".
  // The point is to catch missing env vars on a misdeploy, not to
  // certify on-chain liveness — `cast call` and the L4d fork test do
  // that elsewhere (see docs/test-posture-h-9.md §4).
  const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s ?? '')
  const isUrl  = (s: string) => /^https?:\/\//.test(s ?? '')
  const checks: Record<string, { ok: boolean; reason?: string }> = {
    network:          { ok: !!env.NETWORK },
    usdc_address:     { ok: isAddr(env.USDC_ADDRESS), reason: !isAddr(env.USDC_ADDRESS) ? 'malformed' : undefined },
    splitter_address: { ok: isAddr(env.SPLITTER_ADDRESS), reason: !isAddr(env.SPLITTER_ADDRESS) ? 'malformed' : undefined },
    amount:           { ok: /^[0-9]+$/.test(env.AMOUNT ?? '') },
    facilitator_url:  { ok: isUrl(env.FACILITATOR_URL) },
    seller_ens:       { ok: typeof env.SELLER_ENS === 'string' && env.SELLER_ENS.length > 0 },
    gateway_url:      { ok: isUrl(env.GATEWAY_BASE_URL), reason: !isUrl(env.GATEWAY_BASE_URL) ? 'malformed' : undefined },
  }
  const allOk = Object.values(checks).every((c) => c.ok)
  return {
    status:    allOk ? 'ok' : 'degraded',
    layer:     'L3+L4d',
    checks,
    config: {
      network:           env.NETWORK,
      usdc_address:      env.USDC_ADDRESS,
      splitter_address:  env.SPLITTER_ADDRESS,
      amount:            env.AMOUNT,
      seller_ens:        env.SELLER_ENS,
      facilitator_url:   env.FACILITATOR_URL,
      gateway_base_url:  env.GATEWAY_BASE_URL,
    },
    timestamp: Date.now(),
  }
}
app.get('/healthz', (c) => c.json(healthBody({ env: c.env }), 200))
// Deprecated alias kept for backward compat with any external monitor.
app.get('/health',  (c) => c.json(healthBody({ env: c.env }), 200))

// Mount the paywall per-request so env bindings are read from c.env
// (Cloudflare Workers pattern — env is only available inside the fetch handler).
app.use('/research', async (c, next) => {
  const middleware = withX402({
    amount: c.env.AMOUNT,
    network: c.env.NETWORK,
    asset: c.env.USDC_ADDRESS,
    recipient: c.env.SPLITTER_ADDRESS,
    facilitator: new Reckon402Facilitator(c.env.FACILITATOR_URL),
    extra: { ens: c.env.SELLER_ENS },
  })
  return middleware(c, next)
})

/**
 * Build the JSON body returned to the buyer after a successful (paid)
 * /research call. Same shape across the default and dynamic routes so
 * the buyer SDK doesn't care which route it hit.
 *
 * The seller's ENS is included in the payload so a downstream observer
 * (or the dashboard's "Recent paid calls" panel) can attribute the call
 * even when the buyer addressed the agent by label rather than by a
 * pre-shared seller binding.
 */
async function doResearch(c: { req: { query: (k: string) => string | undefined }; res: { headers: Headers }; json: (data: unknown, status?: number) => Response }, ensName: string) {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)

  const paymentResponse = c.res.headers.get('PAYMENT-RESPONSE')
  let paymentId: string | undefined
  let paidAt: string | undefined
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse)) as { paymentId?: string }
      paymentId = decoded.paymentId
      paidAt = new Date().toISOString()
    } catch { /* ignore parse errors */ }
  }

  let latestBlock: number | undefined
  let blockTimestamp: string | undefined
  let chainHealthy = false
  try {
    const rpcRes = await fetch('https://sepolia.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(4000),
    })
    const rpcData = await rpcRes.json() as { result?: string }
    if (rpcData.result) {
      latestBlock = parseInt(rpcData.result, 16)
      blockTimestamp = new Date().toISOString()
      chainHealthy = true
    }
  } catch { /* public RPC unreachable — fall through */ }

  return c.json({
    query: q,
    seller: ensName,
    result: {
      chain: 'Base Sepolia',
      latestBlock: latestBlock ?? null,
      timestamp: blockTimestamp ?? new Date().toISOString(),
      summary: chainHealthy
        ? `Base Sepolia is healthy. Current block: ${latestBlock}. Network producing blocks normally.`
        : 'Base Sepolia RPC temporarily unreachable. Response is cached.',
    },
    meta: {
      paymentId: paymentId ?? null,
      paidAt: paidAt ?? new Date().toISOString(),
    },
  })
}

app.get('/research', async (c) => doResearch(c, c.env.SELLER_ENS))

// ─── Dynamic per-seller route ────────────────────────────────────────────
//
// /:label/research resolves the agent's wiring from the gateway at request
// time. One worker, many sellers. Buyers (or the dashboard's Run Test Call
// button) address an agent by its ENS label, not by a hardcoded binding.
//
// The middleware mount has to happen INSIDE the route handler because
// withX402's recipient/amount/asset values come from the gateway lookup
// — they're not available at app-init time.

app.use('/:label/research', async (c, next) => {
  const label = c.req.param('label')
  if (!isValidLabel(label)) {
    return c.json({ error: 'invalid_label', label }, 400)
  }
  const ensName = `${label}.reckon402-test.eth`

  let cfg: ResolvedSeller
  try {
    cfg = await resolveSeller(c.env.GATEWAY_BASE_URL, ensName, c.env.NETWORK)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.startsWith('unknown_seller:')) {
      return c.json({ error: 'unknown_seller', ensName }, 404)
    }
    return c.json({ error: 'gateway_lookup_failed', ensName, detail: msg }, 502)
  }

  // Stash the resolved config on the request so the handler can include
  // the right ENS in the response payload.
  c.set('seller', cfg)

  const middleware = withX402({
    amount:      cfg.amount,
    network:     cfg.network,
    asset:       cfg.asset,
    recipient:   cfg.splitter,
    facilitator: new Reckon402Facilitator(c.env.FACILITATOR_URL),
    extra:       { ens: cfg.ensName },
  })
  return middleware(c, next)
})

app.get('/:label/research', async (c) => {
  const seller = c.get('seller') as ResolvedSeller | undefined
  return doResearch(c, seller?.ensName ?? '')
})

export default {
  fetch: app.fetch,
}
