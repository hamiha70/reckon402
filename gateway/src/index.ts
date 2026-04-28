import { Hono } from 'hono'
import type { Env } from './env.js'
import { lookupPost, lookupGet, lookupOptions } from './routes/lookup.js'
import { healthzHandler } from './routes/healthz.js'
import { cacheInvalidateHandler } from './routes/hooks/cache-invalidate.js'

const app = new Hono<{ Bindings: Env }>()

// CORS preflight
app.options('/lookup',     lookupOptions)
app.options('/lookup/*',   lookupOptions)

// CCIP-Read gateway routes
app.post('/lookup',              lookupPost)
app.get('/lookup/:sender/:data', lookupGet)

// Internal hook (bearer-auth; L4b facilitator posts after settle)
app.post('/hooks/cache-invalidate', cacheInvalidateHandler)

// Observability
app.get('/healthz', healthzHandler)

export default {
  fetch: app.fetch,
}
