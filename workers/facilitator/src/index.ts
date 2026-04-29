import { Hono } from 'hono'
import type { Env } from './env.js'
import { verifyHandler } from './verify.js'
import { settleHandler } from './settle-route.js'
import { receiptByPaymentId, receiptByTx, receiptByRequest } from './receipt-route.js'
import { reconcileHandler } from './reconcile-route.js'
import { healthzHandler } from './healthz.js'
import {
  adminReceiptsHandler,
  adminAttestationsHandler,
  adminStuckHandler,
  adminStatusHandler,
} from './admin-route.js'

const x402 = new Hono<{ Bindings: Env }>()
x402.post('/verify',                       verifyHandler)
x402.post('/settle',                       settleHandler)
x402.get('/receipt/by-tx/:transaction',    receiptByTx)
x402.get('/receipt/by-request/:requestId', receiptByRequest)
x402.get('/receipt/:paymentId',            receiptByPaymentId)
x402.post('/reconcile',                    reconcileHandler)

const admin = new Hono<{ Bindings: Env }>()
admin.get('/receipts',      adminReceiptsHandler)
admin.get('/attestations',  adminAttestationsHandler)
admin.get('/stuck',         adminStuckHandler)
admin.get('/status',        adminStatusHandler)

const app = new Hono<{ Bindings: Env }>()
app.route('/x402', x402)
app.route('/admin', admin)
app.get('/healthz', healthzHandler)
app.get('/', (c) =>
  c.text(
    'reckon402 facilitator — Layer L3\n' +
    'Endpoints: POST /x402/verify, POST /x402/settle, GET /x402/receipt/:paymentId\n' +
    'Admin:     GET /admin/status, /admin/receipts, /admin/attestations, /admin/stuck\n' +
    'Health:    GET /healthz\n',
  ),
)

export default {
  fetch: app.fetch,
}
