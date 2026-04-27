import type { FacilitatorVerifyResponse, FacilitatorSettleResponse } from '@reckon402/types'
import type { ReceiptState } from './state-machine.js'

/**
 * Row shape returned by D1 SELECT on the receipts table. Mirrors
 * migrations/0001_init.sql column types.
 */
export interface ReceiptRow {
  payment_id: string
  request_id: string
  state: ReceiptState
  network: string
  version: number
  auth_from: string
  auth_to: string
  auth_value: string
  auth_valid_after: number
  auth_valid_before: number
  auth_nonce: string
  transaction: string | null
  submitted_at: number
  block_number: number | null
  block_timestamp: number | null
  confirmed_at: number | null
  gas_used: string | null
  retry_count: number
  last_retry_at: number | null
  reconcile_notes: string | null
  failure_reason: string | null
  failure_detail: string | null
}

/**
 * Build the verify-response shape (canonical x402-v2 fields at the top,
 * Reckon402 X35 extensions below).
 */
export function buildVerifyResponse(row: ReceiptRow): FacilitatorVerifyResponse {
  return {
    isValid: row.state !== 'FAILED',
    payer: row.auth_from,
    invalidReason: row.state === 'FAILED' ? row.failure_reason ?? 'UNKNOWN' : undefined,
    paymentId: row.payment_id,
    requestId: row.request_id,
    state: row.state,
  }
}

/**
 * Build the settle-response shape. Canonical fields populated from the
 * receipts row; `transaction` is the transferWithAuthorization tx hash
 * (the canonical x402 settlement tx). The Splitter.distribute tx hash
 * is stored in reconcile_notes at L3.
 */
export function buildSettleResponse(row: ReceiptRow): FacilitatorSettleResponse {
  const success = row.state === 'CONFIRMED' || row.state === 'RECONCILED'
  return {
    success,
    transaction: row.transaction ?? '',
    network: row.network,
    payer: row.auth_from,
    amount: row.auth_value,
    errorReason: success ? undefined : row.failure_reason ?? undefined,
    paymentId: row.payment_id,
    requestId: row.request_id,
    state: row.state,
    receipt: {
      state: row.state,
      submittedAt: row.submitted_at,
      confirmedAt: row.confirmed_at,
      blockNumber: row.block_number,
      retryCount: row.retry_count,
      reconcileNotes: row.reconcile_notes,
    },
  }
}
