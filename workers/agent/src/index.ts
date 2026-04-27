import { Hono } from 'hono'
import { withX402 } from './x402-middleware.js'
import { CdpFacilitator } from './cdp-facilitator.js'

// Base Sepolia — L2 constants (hardcoded; L3 moves to wrangler env vars)
const NETWORK = 'eip155:84532'
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SELLER_ADDRESS = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const PRICE_USDC_BASE_UNITS = '10000'  // 0.01 USDC (6 decimals)

const app = new Hono()

app.get('/', (c) => {
  return c.text(
    'reckon402 demo research agent\n' +
    'Layer: L2 (x402 paywall on /research)\n' +
    'Try: GET /research?q=your+question  (requires PAYMENT-SIGNATURE header)\n' +
    'Health: GET /health\n'
  )
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', layer: 'L2' })
})

// /research gated by x402 paywall; / and /health remain free
app.use(
  '/research',
  withX402({
    amount: PRICE_USDC_BASE_UNITS,
    network: NETWORK,
    asset: USDC_BASE_SEPOLIA,
    recipient: SELLER_ADDRESS,
    facilitator: new CdpFacilitator(),
  })
)

app.get('/research', (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  return c.json({
    query: q,
    summary: 'This is a stub response. Real research is coming in a future layer.',
    agent: 'reckon402-demo-research',
    layer: 'L2',
  })
})

export default {
  fetch: app.fetch,
}
