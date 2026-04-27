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
  SPLITTER_ADDRESS: string         // payTo / auth.to
  AMOUNT: string                   // atomic units; "10000" = 0.01 USDC
  FACILITATOR_URL: string          // e.g. "https://facilitator.reckon402.com/x402"
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
  })
  return middleware(c, next)
})

app.get('/research', (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  return c.json({
    query: q,
    summary: 'This is a stub response. Real research is coming in a future layer.',
    agent: 'reckon402-demo-research',
    layer: 'L3',
  })
})

export default {
  fetch: app.fetch,
}
