import type {
  Facilitator,
  FacilitatorVerifyResponse,
  FacilitatorSettleResponse,
  PaymentPayload,
  PaymentRequirements,
} from '@reckon402/types'

/**
 * Reckon402Facilitator — HTTP client for facilitator.reckon402.com.
 *
 * Wraps POST /x402/verify and POST /x402/settle per spec 04 §3.3. The
 * request body is the canonical x402 v2 wrapper
 * `{ x402Version, paymentPayload, paymentRequirements }` (same shape as
 * CdpFacilitator — wire-compat additive superset). Responses preserve
 * canonical x402-v2 field names and carry Reckon402 X35 extensions
 * (paymentId, requestId, state, receipt) as extra fields.
 */
export class Reckon402Facilitator implements Facilitator {
  private readonly baseUrl: string

  constructor(baseUrl = 'https://facilitator.reckon402.com/x402') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<FacilitatorVerifyResponse> {
    const res = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        isValid: false,
        invalidReason: `facilitator_http_error:${res.status}:${text}`,
      }
    }

    const data = (await res.json()) as FacilitatorVerifyResponse
    return {
      isValid: data.isValid,
      payer: data.payer,
      invalidReason: data.invalidReason,
      paymentId: data.paymentId,
      requestId: data.requestId,
      state: data.state,
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<FacilitatorSettleResponse> {
    const res = await fetch(`${this.baseUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        success: false,
        transaction: '',
        network: requirements.network,
        errorReason: `facilitator_http_error:${res.status}:${text}`,
      }
    }

    const data = (await res.json()) as FacilitatorSettleResponse
    return {
      success: data.success,
      transaction: data.transaction,
      network: data.network,
      payer: data.payer,
      errorReason: data.errorReason,
      amount: data.amount,
      paymentId: data.paymentId,
      requestId: data.requestId,
      state: data.state,
      receipt: data.receipt,
    }
  }
}
