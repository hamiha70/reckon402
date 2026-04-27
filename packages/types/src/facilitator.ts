import type { PaymentPayload, PaymentRequirements } from './x402.js'

/**
 * Facilitator verify response.
 * Canonical fields match the x402.org public facilitator.
 * Reckon402 X35 extension fields (paymentId, requestId, state) are optional
 * so CDP responses (which omit them) and Reckon402 L3 responses (which include
 * them) both type-check against this interface.
 */
export interface FacilitatorVerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  // Reckon402 X35 extensions — CDP omits, Reckon402 L3 populates
  paymentId?: string
  requestId?: string
  state?: string
}

/**
 * Facilitator settle response.
 * `transaction` field name is canonical (NOT `txHash`).
 * `payer` is at top level (NOT `from` at top level).
 * `network` is CAIP-2 string.
 */
export interface FacilitatorSettleResponse {
  success: boolean
  transaction: string
  network: string
  payer?: string
  errorReason?: string
  amount?: string
  // Reckon402 X35 extensions — CDP omits, Reckon402 L3 populates
  paymentId?: string
  requestId?: string
  state?: string
  receipt?: Record<string, unknown>
}

/**
 * Facilitator interface — the L2↔L3 swap point.
 *
 * Both `CdpFacilitator` (L2, wraps x402.org) and `Reckon402Facilitator`
 * (L3, wraps facilitator.reckon402.com) implement this interface.
 * The Hono middleware imports only this interface; the concrete impl is
 * wired in at `index.ts` via `withX402({ facilitator: new CdpFacilitator() })`.
 * L3 swaps by replacing that one constructor call — no middleware-code change.
 */
export interface Facilitator {
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<FacilitatorVerifyResponse>

  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<FacilitatorSettleResponse>
}
