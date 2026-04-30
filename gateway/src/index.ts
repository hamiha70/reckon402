import { Hono } from 'hono'
import type { Env } from './env.js'
import { lookupPost, lookupGet, lookupOptions } from './routes/lookup.js'
import { healthzHandler } from './routes/healthz.js'
import { cacheInvalidateHandler } from './routes/hooks/cache-invalidate.js'
import { adminRecordsHandler } from './routes/admin/records.js'
import { adminBootstrapHandler, adminBootstrapGatewaySeedHandler } from './routes/admin/bootstrap.js'
import { recordsFlatHandler, recordsFlatOptions } from './routes/records-flat.js'

const app = new Hono<{ Bindings: Env }>()

// CORS preflight
app.options('/lookup',          lookupOptions)
app.options('/lookup/*',        lookupOptions)
app.options('/records/:ensName', recordsFlatOptions)

// CCIP-Read gateway routes
app.post('/lookup',              lookupPost)
app.get('/lookup/:sender/:data', lookupGet)

// Internal hook (bearer-auth; L4b facilitator posts after settle)
app.post('/hooks/cache-invalidate', cacheInvalidateHandler)

// L4c signed-write admin surface (spec 08B §4)
app.post('/admin/records',                  adminRecordsHandler)
app.post('/admin/bootstrap',                adminBootstrapHandler)
app.post('/admin/bootstrap/gateway-seed',   adminBootstrapGatewaySeedHandler)

// Flat records endpoint (browser-friendly; ?flat=true&backend=erc8004)
app.get('/records/:ensName', recordsFlatHandler)

// Observability
app.get('/healthz', healthzHandler)

export default {
  fetch: app.fetch,
}
