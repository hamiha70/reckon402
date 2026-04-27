import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import type {
  Facilitator,
  PaymentPayload,
  PaymentRequirements,
  XPaymentRequired,
} from '@reckon402/types'
import { computePaymentId } from './payment-id.js'

export interface X402Options {
  amount: string
  network: string
  asset: string
  recipient: string
  facilitator: Facilitator
}

function buildPaymentRequired(url: string, opts: X402Options): XPaymentRequired {
  return {
    x402Version: 2,
    resource: { url },
    accepts: [
      {
        scheme: 'exact',
        network: opts.network,
        amount: opts.amount,
        asset: opts.asset,
        payTo: opts.recipient,
        maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      } satisfies PaymentRequirements,
    ],
  }
}

/**
 * Hono middleware factory that gates a route behind an x402 v2 paywall.
 *
 * On missing payment: sets PAYMENT-REQUIRED header and returns 402.
 * On valid payment: verifies + settles via the injected Facilitator,
 *   sets PAYMENT-RESPONSE header, logs paymentId, then calls next().
 *
 * The middleware is Facilitator-agnostic: swap CdpFacilitator for
 * Reckon402Facilitator at the call site in index.ts for L3.
 */
export function withX402(opts: X402Options): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const headerRaw =
      c.req.header('payment-signature') ?? c.req.header('x-payment')

    if (!headerRaw) {
      const pr = buildPaymentRequired(c.req.url, opts)
      c.header('PAYMENT-REQUIRED', btoa(JSON.stringify(pr)))
      return c.json({ error: 'Payment required', x402Version: 2 }, 402)
    }

    // Decode and validate the payment payload
    let payload: PaymentPayload
    try {
      const decoded = atob(headerRaw)
      payload = JSON.parse(decoded) as PaymentPayload
    } catch {
      return c.json({ error: 'Invalid PAYMENT-SIGNATURE: not valid base64 JSON' }, 400)
    }

    if (payload.x402Version !== 2) {
      return c.json(
        { error: 'UNSUPPORTED_VERSION', message: 'Only x402Version 2 is accepted' },
        400
      )
    }

    const auth = payload.payload?.authorization
    if (!auth) {
      return c.json({ error: 'Missing payload.authorization' }, 400)
    }

    // Enforce 30-second deadline floor (design pack §4.1 step 3)
    const validBefore = Number(auth.validBefore)
    if (validBefore - Math.floor(Date.now() / 1000) < 30) {
      return c.json(
        {
          error: 'DEADLINE_TOO_TIGHT',
          message: 'validBefore must be at least 30 seconds in the future',
        },
        402
      )
    }

    // Network check
    const chosenReqs = payload.accepted
    if (!chosenReqs || chosenReqs.network !== opts.network) {
      return c.json(
        {
          error: 'WRONG_NETWORK',
          expected: opts.network,
          got: chosenReqs?.network,
        },
        402
      )
    }

    // Verify
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: opts.network,
      amount: opts.amount,
      asset: opts.asset,
      payTo: opts.recipient,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2' },
    }

    const verifyResult = await opts.facilitator.verify(payload, requirements)
    if (!verifyResult.isValid) {
      return c.json(
        { error: verifyResult.invalidReason ?? 'VERIFICATION_FAILED' },
        402
      )
    }

    // Compute and log paymentId (L2 forward-compat logging; CDP won't echo it)
    const paymentId = computePaymentId(auth)
    console.log(`[x402] paymentId=${paymentId} payer=${verifyResult.payer}`)

    // Settle
    const settleResult = await opts.facilitator.settle(payload, requirements)
    if (!settleResult.success) {
      return c.json(
        { error: settleResult.errorReason ?? 'SETTLEMENT_FAILED' },
        502
      )
    }

    console.log(
      `[x402] settled paymentId=${paymentId} tx=${settleResult.transaction} network=${settleResult.network}`
    )

    c.header('PAYMENT-RESPONSE', btoa(JSON.stringify(settleResult)))

    await next()
  })
}
