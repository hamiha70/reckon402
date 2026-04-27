import type {
  Facilitator,
  FacilitatorVerifyResponse,
  FacilitatorSettleResponse,
  PaymentPayload,
  PaymentRequirements,
} from '@reckon402/types'

/**
 * CdpFacilitator — wraps the x402 Foundation open testnet facilitator
 * at https://x402.org/facilitator. No auth; testnet/dev use only.
 *
 * Lifted verbatim from workers/agent/src/cdp-facilitator.ts at L3 so
 * the L2 seller path stays reachable as a fallback / comparison.
 */
export class CdpFacilitator implements Facilitator {
  private readonly baseUrl: string

  constructor(baseUrl = 'https://x402.org/facilitator') {
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

    const data = (await res.json()) as {
      isValid: boolean
      payer?: string
      invalidReason?: string
    }

    return {
      isValid: data.isValid,
      payer: data.payer,
      invalidReason: data.invalidReason,
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

    const data = (await res.json()) as {
      success: boolean
      transaction: string
      network: string
      payer?: string
      errorReason?: string
      amount?: string
    }

    return {
      success: data.success,
      transaction: data.transaction,
      network: data.network,
      payer: data.payer,
      errorReason: data.errorReason,
      amount: data.amount,
    }
  }
}
