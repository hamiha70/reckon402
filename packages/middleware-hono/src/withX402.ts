import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import type {
  Facilitator,
  PaymentPayload,
  PaymentRequirements,
  XPaymentRequired,
} from '@reckon402/types'
import { computePaymentId } from '@reckon402/buyer-sdk'

export interface X402Options {
  amount: string
  network: string              // CAIP-2, e.g. "eip155:84532"
  asset: string                // USDC address
  recipient: string            // payTo — at L3 this is the Splitter address
  facilitator: Facilitator
  extra?: Record<string, string>  // merged into PaymentRequirements.extra (e.g. { ens: "seller.reckon402-test.eth" })
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
        extra: { name: 'USDC', version: '2', ...opts.extra },
      } satisfies PaymentRequirements,
    ],
  }
}

/**
 * Hono middleware that gates a route behind an x402 v2 paywall.
 *
 * Flow (per specs/03-l2-x402-paywall.md §5.3):
 *   1. Read PAYMENT-SIGNATURE header (fallback: x-payment).
 *   2. Absent → 402 + PAYMENT-REQUIRED header.
 *   3. Decode + validate (base64 JSON, x402Version=2, deadline ≥ 30s, network match).
 *   4. facilitator.verify() — 402 on failure.
 *   5. Compute paymentId (logged for observability).
 *   6. facilitator.settle() — 502 on failure.
 *   7. Set PAYMENT-RESPONSE header (base64 of settle result).
 *   8. await next().
 *
 * This factory is Facilitator-agnostic. Both CdpFacilitator (L2) and
 * Reckon402Facilitator (L3) plug in unchanged via the `facilitator` opt.
 */
export function withX402(opts: X402Options): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const headerRaw = c.req.header('payment-signature') ?? c.req.header('x-payment')

    if (!headerRaw) {
      const pr = buildPaymentRequired(c.req.url, opts)
      c.header('PAYMENT-REQUIRED', btoa(JSON.stringify(pr)))
      return c.json({ error: 'Payment required', x402Version: 2 }, 402)
    }

    let payload: PaymentPayload
    try {
      payload = JSON.parse(atob(headerRaw)) as PaymentPayload
    } catch {
      return c.json({ error: 'Invalid PAYMENT-SIGNATURE: not valid base64 JSON' }, 400)
    }

    if (payload.x402Version !== 2) {
      return c.json(
        { error: 'UNSUPPORTED_VERSION', message: 'Only x402Version 2 is accepted' },
        400,
      )
    }

    const auth = payload.payload?.authorization
    if (!auth) {
      return c.json({ error: 'Missing payload.authorization' }, 400)
    }

    if (Number(auth.validBefore) - Math.floor(Date.now() / 1000) < 30) {
      return c.json(
        {
          error: 'DEADLINE_TOO_TIGHT',
          message: 'validBefore must be at least 30 seconds in the future',
        },
        402,
      )
    }

    const chosen = payload.accepted
    if (!chosen || chosen.network !== opts.network) {
      return c.json(
        { error: 'WRONG_NETWORK', expected: opts.network, got: chosen?.network },
        402,
      )
    }

    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: opts.network,
      amount: opts.amount,
      asset: opts.asset,
      payTo: opts.recipient,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2', ...opts.extra },
    }

    const verifyResult = await opts.facilitator.verify(payload, requirements)
    if (!verifyResult.isValid) {
      return c.json(
        { error: verifyResult.invalidReason ?? 'VERIFICATION_FAILED' },
        402,
      )
    }

    const paymentId = computePaymentId(auth)
    console.log(`[x402] paymentId=${paymentId} payer=${verifyResult.payer}`)

    const settleResult = await opts.facilitator.settle(payload, requirements)
    if (!settleResult.success) {
      return c.json(
        { error: settleResult.errorReason ?? 'SETTLEMENT_FAILED' },
        502,
      )
    }

    console.log(
      `[x402] settled paymentId=${paymentId} tx=${settleResult.transaction} network=${settleResult.network}`,
    )

    c.header('PAYMENT-RESPONSE', btoa(JSON.stringify(settleResult)))

    await next()
  })
}
