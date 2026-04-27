import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text(
    'reckon402 demo research agent\n' +
    'Layer: L1 (stub — no paywall yet)\n' +
    'Try: GET /research?q=your+question\n' +
    'Health: GET /health\n'
  )
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', layer: 'L1' })
})

app.get('/research', (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  return c.json({
    query: q,
    summary: 'This is a stub response. Real research is coming in a future layer.',
    agent: 'reckon402-demo-research',
    layer: 'L1',
  })
})

export default {
  fetch: app.fetch,
}
