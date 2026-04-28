import { Hono } from 'hono'
import type { Env } from './env.js'
import { lookupPost, lookupGet, lookupOptions } from './routes/lookup.js'
import { healthzHandler } from './routes/healthz.js'

const app = new Hono<{ Bindings: Env }>()

// CORS preflight
app.options('/lookup',     lookupOptions)
app.options('/lookup/*',   lookupOptions)

// CCIP-Read gateway routes
app.post('/lookup',              lookupPost)
app.get('/lookup/:sender/:data', lookupGet)

// Observability
app.get('/healthz', healthzHandler)

export default {
  fetch: app.fetch,
}
