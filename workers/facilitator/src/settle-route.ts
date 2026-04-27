import type { Context } from 'hono'
import type { Env } from './env.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'
import { computePaymentId } from './payment-id.js'
import { settleOnChain } from './settle.js'
import { buildSettleResponse, type ReceiptRow } from './receipt-builder.js'

/**
 * POST /x402/settle — design pack 02_facilitator.md §4.2.
 *
 * Behaviour at L3 (§3.3 of spec 04): the middleware calls verify() then
 * settle() back-to-back. Our /x402/settle is responsible for:
 *   1. Reading the SUBMITTED receipt row (or creating it idempotently
 *      from the paymentPayload if /verify wasn't called — defensive).
 *   2. Guarded state transition SUBMITTED -> PENDING_CONFIRMATION via
 *      UPDATE ... WHERE state = 'SUBMITTED' (race-safe per §6.2).
 *   3. Running settleOnChain (two txs, inline poll).
 *   4. Transitioning to CONFIRMED or FAILED based on outcome.
 *   5. Returning the FacilitatorSettleResponse with canonical x402-v2
 *      field names at the top.
 *
 * If the row is already CONFIRMED/RECONCILED (replay), short-circuit
 * from D1 — no new on-chain tx. This is the load-bearing replay-protection
 * path demonstrated by tools/integration-tests/replay-l3.sh.
 */
export async function settleHandler(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    x402Version: number
    paymentPayload: PaymentPayload
    paymentRequirements: PaymentRequirements
  }>().catch(() => null)

  if (!body || body.x402Version !== 2 || body.paymentPayload?.x402Version !== 2) {
    return c.json({
      success: false,
      transaction: '',
      network: c.env.NETWORK,
      errorReason: 'UNSUPPORTED_VERSION',
    }, 400)
  }

  const { paymentPayload, paymentRequirements } = body
  const auth = paymentPayload.payload?.authorization
  const sig  = paymentPayload.payload?.signature as `0x${string}` | undefined
  if (!auth || !sig) {
    return c.json({
      success: false,
      transaction: '',
      network: c.env.NETWORK,
      errorReason: 'MISSING_AUTHORIZATION_OR_SIGNATURE',
    }, 400)
  }

  if (paymentRequirements.network !== c.env.NETWORK) {
    return c.json({
      success: false,
      transaction: '',
      network: c.env.NETWORK,
      errorReason: 'UNSUPPORTED_NETWORK',
    }, 400)
  }

  const paymentId = computePaymentId(auth)

  // Replay short-circuit: if the row is already CONFIRMED or RECONCILED,
  // return the existing snapshot unchanged. This is how replay-l3.sh
  // proves idempotency — the second call never reaches settleOnChain.
  const existing = await c.env.DB
    .prepare(`SELECT * FROM receipts WHERE payment_id = ?1`)
    .bind(paymentId)
    .first<ReceiptRow>()

  if (existing && (existing.state === 'CONFIRMED' || existing.state === 'RECONCILED')) {
    c.header('X-Reckon402-Request-Id', existing.request_id)
    c.header('X-Reckon402-Replay', 'true')
    return c.json(buildSettleResponse(existing), 200)
  }

  if (existing && existing.state === 'FAILED') {
    c.header('X-Reckon402-Request-Id', existing.request_id)
    return c.json(buildSettleResponse(existing), 502)
  }

  // Ensure a row exists (defensive: callers may call /settle directly without
  // prior /verify). INSERT OR IGNORE preserves the verify-derived row if
  // it already exists.
  const requestId = existing?.request_id ?? crypto.randomUUID()
  const submittedAt = existing?.submitted_at ?? Date.now()
  if (!existing) {
    await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO receipts (
          payment_id, request_id, state, network, version,
          auth_from, auth_to, auth_value, auth_valid_after, auth_valid_before, auth_nonce,
          submitted_at
        ) VALUES (?1, ?2, 'SUBMITTED', ?3, 2, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        paymentId, requestId, c.env.NETWORK,
        auth.from, auth.to, auth.value,
        Number(auth.validAfter), Number(auth.validBefore), auth.nonce,
        submittedAt,
      )
      .run()
  }

  // Guarded SUBMITTED -> PENDING_CONFIRMATION transition. `changes === 0`
  // means another concurrent call claimed the row first; we re-read and
  // return current state without submitting a second tx.
  const claim = await c.env.DB
    .prepare(
      `UPDATE receipts
       SET state = 'PENDING_CONFIRMATION', last_retry_at = ?2
       WHERE payment_id = ?1 AND state = 'SUBMITTED'`,
    )
    .bind(paymentId, Date.now())
    .run()

  if (claim.meta.changes === 0) {
    const refetched = await c.env.DB
      .prepare(`SELECT * FROM receipts WHERE payment_id = ?1`)
      .bind(paymentId)
      .first<ReceiptRow>()
    if (!refetched) {
      return c.json({
        success: false,
        transaction: '',
        network: c.env.NETWORK,
        errorReason: 'RECEIPT_DISAPPEARED',
      }, 500)
    }
    c.header('X-Reckon402-Request-Id', refetched.request_id)
    const status = refetched.state === 'CONFIRMED' || refetched.state === 'RECONCILED' ? 200 : 502
    return c.json(buildSettleResponse(refetched), status)
  }

  // Run the two-tx settle.
  const outcome = await settleOnChain(
    {
      FACILITATOR_PK: c.env.FACILITATOR_PK,
      USDC_ADDRESS: c.env.USDC_ADDRESS,
      SPLITTER_ADDRESS: c.env.SPLITTER_ADDRESS,
      BASE_SEPOLIA_RPC_PRIMARY: c.env.BASE_SEPOLIA_RPC_PRIMARY,
      BASE_SEPOLIA_RPC_FALLBACK: c.env.BASE_SEPOLIA_RPC_FALLBACK,
    },
    { authorization: auth, signature: sig, paymentId },
  )

  if (outcome.success) {
    await c.env.DB
      .prepare(
        `UPDATE receipts
         SET state = 'CONFIRMED',
             transaction = ?2,
             block_number = ?3,
             block_timestamp = ?4,
             confirmed_at = ?5,
             gas_used = ?6,
             reconcile_notes = ?7
         WHERE payment_id = ?1`,
      )
      .bind(
        paymentId,
        outcome.transferTx,
        Number(outcome.blockNumber),
        Number(outcome.blockTimestamp),
        Date.now(),
        outcome.gasUsed.toString(),
        `distributeTx=${outcome.distributeTx}`,
      )
      .run()
  } else {
    await c.env.DB
      .prepare(
        `UPDATE receipts
         SET state = 'FAILED',
             transaction = COALESCE(?2, transaction),
             failure_reason = ?3,
             failure_detail = ?4
         WHERE payment_id = ?1`,
      )
      .bind(
        paymentId,
        outcome.transferTx ?? null,
        outcome.failureReason,
        outcome.failureDetail,
      )
      .run()
  }

  const finalRow = await c.env.DB
    .prepare(`SELECT * FROM receipts WHERE payment_id = ?1`)
    .bind(paymentId)
    .first<ReceiptRow>()

  if (!finalRow) {
    return c.json({
      success: false,
      transaction: '',
      network: c.env.NETWORK,
      errorReason: 'RECEIPT_NOT_FOUND_AFTER_SETTLE',
    }, 500)
  }

  c.header('X-Reckon402-Request-Id', finalRow.request_id)
  const status = finalRow.state === 'CONFIRMED' || finalRow.state === 'RECONCILED' ? 200 : 502
  return c.json(buildSettleResponse(finalRow), status)
}
