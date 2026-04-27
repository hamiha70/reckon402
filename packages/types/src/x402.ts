/**
 * Canonical x402 Foundation protocol v2 wire-format types.
 * Source: github.com/x402-foundation/x402 spec, version x402Version=2.
 */

export interface EIP3009Authorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}

export interface PaymentRequirements {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: {
    name: string
    version: string
    [key: string]: unknown
  }
}

export interface PaymentPayload {
  x402Version: number
  resource?: { url: string; description?: string; mimeType?: string }
  accepted: PaymentRequirements
  payload: {
    signature: string
    authorization: EIP3009Authorization
  }
  extensions?: Record<string, unknown>
}

export interface XPaymentRequired {
  x402Version: number
  error?: string
  resource: { url: string; description?: string; mimeType?: string }
  accepts: PaymentRequirements[]
  extensions?: Record<string, unknown>
}

export interface SettlementResponse {
  success: boolean
  transaction: string
  network: string
  payer?: string
  errorReason?: string
  amount?: string
}
