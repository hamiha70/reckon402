import type { Context } from 'hono'
import type { Env } from './env.js'
import { buildSettleResponse, type ReceiptRow } from './receipt-builder.js'

async function readRow(c: Context<{ Bindings: Env }>, sql: string, arg: string) {
  return await c.env.DB.prepare(sql).bind(arg).first<ReceiptRow>()
}

export async function receiptByPaymentId(c: Context<{ Bindings: Env }>) {
  const paymentId = c.req.param('paymentId')
  const row = await readRow(c, `SELECT * FROM receipts WHERE payment_id = ?1`, paymentId)
  if (!row) return c.json({ error: 'RECEIPT_NOT_FOUND', paymentId }, 404)
  c.header('X-Reckon402-Request-Id', row.request_id)
  return c.json(buildSettleResponse(row), 200)
}

export async function receiptByTx(c: Context<{ Bindings: Env }>) {
  const tx = c.req.param('transaction')
  const row = await readRow(c, `SELECT * FROM receipts WHERE transaction = ?1`, tx)
  if (!row) return c.json({ error: 'RECEIPT_NOT_FOUND', transaction: tx }, 404)
  c.header('X-Reckon402-Request-Id', row.request_id)
  return c.json(buildSettleResponse(row), 200)
}

export async function receiptByRequest(c: Context<{ Bindings: Env }>) {
  const rid = c.req.param('requestId')
  const row = await readRow(c, `SELECT * FROM receipts WHERE request_id = ?1`, rid)
  if (!row) return c.json({ error: 'RECEIPT_NOT_FOUND', requestId: rid }, 404)
  c.header('X-Reckon402-Request-Id', row.request_id)
  return c.json(buildSettleResponse(row), 200)
}
