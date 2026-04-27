import type { Context } from 'hono'
import type { Env } from './env.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'
import { computePaymentId } from './payment-id.js'
import { caip2ToChainId, recoverEip3009Signer } from './eip3009.js'
import { buildVerifyResponse, type ReceiptRow } from './receipt-builder.js'

/**
 * POST /x402/verify — design pack 02_facilitator.md §4.1.
 *
 * Wire-compat with the x402.org facilitator (what the middleware's
 * Facilitator.verify() calls): body shape {paymentPayload, paymentRequirements}.
 * Response body: FacilitatorVerifyResponse with Reckon402 X35 extensions.
 *
 * Validation steps (§4.1): version=2; network match; deadline ≥ 30s;
 * signature recovery (ECDSA only at L3); INSERT OR IGNORE receipt as SUBMITTED.
 */
export async function verifyHandler(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    x402Version: number
    paymentPayload: PaymentPayload
    paymentRequirements: PaymentRequirements
  }>().catch(() => null)

  if (!body || body.x402Version !== 2 || body.paymentPayload?.x402Version !== 2) {
    return c.json({ isValid: false, invalidReason: 'UNSUPPORTED_VERSION' }, 400)
  }

  const { paymentPayload, paymentRequirements } = body
  const auth = paymentPayload.payload?.authorization
  if (!auth) {
    return c.json({ isValid: false, invalidReason: 'MISSING_AUTHORIZATION' }, 400)
  }

  if (paymentRequirements.network !== c.env.NETWORK) {
    return c.json({ isValid: false, invalidReason: 'UNSUPPORTED_NETWORK' }, 400)
  }

  const nowSec = Math.floor(Date.now() / 1000)
  if (Number(auth.validBefore) - nowSec < 30) {
    return c.json({ isValid: false, invalidReason: 'DEADLINE_TOO_TIGHT' }, 400)
  }

  const chainId = caip2ToChainId(c.env.NETWORK)
  let recovered: `0x${string}`
  try {
    recovered = await recoverEip3009Signer({
      authorization: auth,
      signature: paymentPayload.payload.signature as `0x${string}`,
      chainId,
      usdcAddress: c.env.USDC_ADDRESS as `0x${string}`,
    })
  } catch (err) {
    return c.json({ isValid: false, invalidReason: `SIGNATURE_RECOVERY_FAILED: ${(err as Error).message}` }, 401)
  }

  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    return c.json({
      isValid: false,
      invalidReason: `INVALID_SIGNATURE: recovered=${recovered} expected=${auth.from}`,
    }, 401)
  }

  const paymentId = computePaymentId(auth)
  const requestId = crypto.randomUUID()
  const submittedAt = Date.now()

  // INSERT OR IGNORE — idempotent on paymentId. If already present, read the
  // existing row (replays of the same authorization return the current state).
  await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO receipts (
        payment_id, request_id, state, network, version,
        auth_from, auth_to, auth_value, auth_valid_after, auth_valid_before, auth_nonce,
        submitted_at
      ) VALUES (?1, ?2, 'SUBMITTED', ?3, 2, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      paymentId,
      requestId,
      c.env.NETWORK,
      auth.from,
      auth.to,
      auth.value,
      Number(auth.validAfter),
      Number(auth.validBefore),
      auth.nonce,
      submittedAt,
    )
    .run()

  const row = await c.env.DB
    .prepare(`SELECT * FROM receipts WHERE payment_id = ?1`)
    .bind(paymentId)
    .first<ReceiptRow>()

  if (!row) {
    return c.json({ isValid: false, invalidReason: 'RECEIPT_NOT_FOUND_AFTER_INSERT' }, 500)
  }

  c.header('X-Reckon402-Request-Id', row.request_id)
  return c.json(buildVerifyResponse(row), 200)
}
