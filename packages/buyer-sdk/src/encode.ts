import type { PaymentPayload, SettlementResponse } from '@reckon402/types'

/**
 * Encode a PaymentPayload into the PAYMENT-SIGNATURE header value
 * (base64 of JSON). Works under Node 22 (btoa is global) and Workers.
 */
export function encodeXPaymentHeader(payload: PaymentPayload): string {
  return btoa(JSON.stringify(payload))
}

/**
 * Decode a PAYMENT-RESPONSE header value back into a SettlementResponse.
 * The Reckon402 facilitator emits X35 extensions (paymentId, requestId,
 * state, receipt) on top of the canonical fields; this helper returns
 * the raw parsed object so callers can read whichever fields they need.
 */
export function decodeXPaymentResponse(headerValue: string): SettlementResponse & Record<string, unknown> {
  return JSON.parse(atob(headerValue)) as SettlementResponse & Record<string, unknown>
}
