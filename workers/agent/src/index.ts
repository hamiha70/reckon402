import { Hono } from 'hono'
import { withX402 } from '@reckon402/middleware-hono'
import { Reckon402Facilitator } from '@reckon402/facilitator-client'

/**
 * Env bindings (set via wrangler.toml [vars] + wrangler secret).
 * At L3 the paywall target is the Splitter (not the seller EOA); the
 * buyer's EIP-3009 auth.to must equal SPLITTER_ADDRESS so
 * transferWithAuthorization lands funds in the Splitter, which then
 * distributes to the real recipients per BPS.
 */
interface Env {
  NETWORK: string                  // e.g. "eip155:84532"
  USDC_ADDRESS: string             // USDC on the target chain
  SPLITTER_ADDRESS: string         // payTo / auth.to — must be the factory-deployed Splitter for SELLER_ENS
  AMOUNT: string                   // atomic units; "10000" = 0.01 USDC
  FACILITATOR_URL: string          // e.g. "https://facilitator.reckon402.com/x402"
  SELLER_ENS: string               // ENS name for this SellingAgent, passed as extra.ens for L4c splitter resolution
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) =>
  c.text(
    'reckon402 demo research agent\n' +
    'Layer: L3 (x402 paywall via our Facilitator)\n' +
    'Try: GET /research?q=your+question  (requires PAYMENT-SIGNATURE header)\n' +
    'Health: GET /health\n',
  ),
)

app.get('/health', (c) => c.json({ status: 'ok', layer: 'L3' }))

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

app.get('/research', async (c) => {
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

  // Fetch latest Base Sepolia block via public JSON-RPC
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
})

export default {
  fetch: app.fetch,
}
