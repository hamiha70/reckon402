/**
 * GET /admin/receipts   — last N receipts with full fields incl. tdErc8004Tx
 * GET /admin/attestations — last N attestation rows
 * GET /admin/stuck      — receipts in PENDING_CONFIRMATION or SUBMITTED > 5 min
 *
 * All routes require: Authorization: Bearer <ADMIN_TOKEN>
 * If ADMIN_TOKEN is not set, all routes return 403.
 *
 * Query params:
 *   limit  (1–100, default 20)
 *   state  filter by receipt state (optional)
 */
import type { Context } from 'hono'
import type { Env } from './env.js'
import { makeLogger } from '@reckon402/logger'

const log = makeLogger('admin')

function checkAuth(c: Context<{ Bindings: Env }>): boolean {
  const token = c.env.ADMIN_TOKEN
  if (!token) return false
  const authHeader = c.req.header('Authorization') ?? ''
  return authHeader === `Bearer ${token}`
}

function limit(c: Context<{ Bindings: Env }>): number {
  const raw = Number(c.req.query('limit') ?? '20')
  return Math.max(1, Math.min(100, isNaN(raw) ? 20 : raw))
}

export async function adminReceiptsHandler(c: Context<{ Bindings: Env }>) {
  if (!checkAuth(c)) {
    log.warn('auth_failed', { path: '/admin/receipts', ip: c.req.header('CF-Connecting-IP') })
    return c.json({ error: 'unauthorized' }, 401)
  }

  const n = limit(c)
  const stateFilter = c.req.query('state')
  // Optional payTo filter — used by the dashboard to scope receipts to a
  // single agent's per-agent Splitter so each agent's view shows only its
  // own paid calls. Case-insensitive (Ethereum addresses are case-insensitive
  // in practice; we lower-cased on insert in settle.ts at L4d migration).
  const payToFilter = c.req.query('payTo')?.toLowerCase()

  // Build query dynamically. SQLite's `?` placeholders don't support
  // optional clauses cleanly, so we branch on filter presence.
  let rows
  if (stateFilter && payToFilter) {
    rows = await c.env.DB
      .prepare(`SELECT * FROM receipts WHERE state = ?1 AND LOWER(auth_to) = ?2 ORDER BY submitted_at DESC LIMIT ?3`)
      .bind(stateFilter, payToFilter, n)
      .all()
  } else if (stateFilter) {
    rows = await c.env.DB
      .prepare(`SELECT * FROM receipts WHERE state = ?1 ORDER BY submitted_at DESC LIMIT ?2`)
      .bind(stateFilter, n)
      .all()
  } else if (payToFilter) {
    rows = await c.env.DB
      .prepare(`SELECT * FROM receipts WHERE LOWER(auth_to) = ?1 ORDER BY submitted_at DESC LIMIT ?2`)
      .bind(payToFilter, n)
      .all()
  } else {
    rows = await c.env.DB
      .prepare(`SELECT * FROM receipts ORDER BY submitted_at DESC LIMIT ?1`)
      .bind(n)
      .all()
  }

  log.info('admin_receipts', { limit: n, state: stateFilter ?? 'all', payTo: payToFilter ?? 'all', count: rows.results.length })
  return c.json({
    count: rows.results.length,
    receipts: rows.results.map(r => ({
      paymentId:     (r as Record<string, unknown>).payment_id,
      state:         (r as Record<string, unknown>).state,
      payer:         (r as Record<string, unknown>).auth_from,
      // payTo (= per-agent Splitter) — exposed so the dashboard can filter
      // and so it's visible in admin tooling.
      payTo:         (r as Record<string, unknown>).auth_to,
      amount:        (r as Record<string, unknown>).auth_value,
      tx:            (r as Record<string, unknown>).transaction,
      tdErc8004Tx:   (r as Record<string, unknown>).td_erc8004_tx,
      submittedAt:   (r as Record<string, unknown>).submitted_at,
      confirmedAt:   (r as Record<string, unknown>).confirmed_at,
      blockNumber:   (r as Record<string, unknown>).block_number,
      retryCount:    (r as Record<string, unknown>).retry_count,
      reconcileNotes:(r as Record<string, unknown>).reconcile_notes,
      failureReason: (r as Record<string, unknown>).failure_reason,
      failureDetail: (r as Record<string, unknown>).failure_detail,
    })),
  })
}

export async function adminAttestationsHandler(c: Context<{ Bindings: Env }>) {
  if (!checkAuth(c)) return c.json({ error: 'unauthorized' }, 401)

  const n = limit(c)
  const rows = await c.env.DB
    .prepare(`SELECT * FROM attestations ORDER BY written_at DESC LIMIT ?1`)
    .bind(n)
    .all()

  log.info('admin_attestations', { limit: n, count: rows.results.length })
  return c.json({ count: rows.results.length, attestations: rows.results })
}

export async function adminStuckHandler(c: Context<{ Bindings: Env }>) {
  if (!checkAuth(c)) return c.json({ error: 'unauthorized' }, 401)

  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
  const rows = await c.env.DB
    .prepare(
      `SELECT payment_id, state, submitted_at, retry_count, failure_detail
       FROM receipts
       WHERE state IN ('PENDING_CONFIRMATION', 'SUBMITTED')
         AND submitted_at < ?1
       ORDER BY submitted_at ASC
       LIMIT 50`,
    )
    .bind(fiveMinutesAgo)
    .all()

  const stuck = rows.results.length
  log.info('admin_stuck', { stuck })
  return c.json({ stuck, receipts: rows.results })
}

export async function adminStatusHandler(c: Context<{ Bindings: Env }>) {
  if (!checkAuth(c)) return c.json({ error: 'unauthorized' }, 401)

  const [counts, latest, latestAtt] = await Promise.all([
    c.env.DB
      .prepare(`SELECT state, COUNT(*) as n FROM receipts GROUP BY state ORDER BY n DESC`)
      .all(),
    c.env.DB
      .prepare(`SELECT payment_id, state, confirmed_at, td_erc8004_tx FROM receipts ORDER BY submitted_at DESC LIMIT 5`)
      .all(),
    c.env.DB
      .prepare(`SELECT payment_id, reputation_tx, written_at FROM attestations ORDER BY written_at DESC LIMIT 3`)
      .all(),
  ])

  return c.json({
    stateCounts: counts.results,
    latestReceipts: latest.results,
    latestAttestations: latestAtt.results,
  })
}
