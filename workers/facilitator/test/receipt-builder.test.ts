import { describe, it, expect } from 'vitest'
import { buildVerifyResponse, buildSettleResponse, type ReceiptRow } from '../src/receipt-builder.js'

const base: ReceiptRow = {
  payment_id: '0x' + 'ab'.repeat(32),
  request_id: '00000000-0000-4000-8000-000000000000',
  state: 'SUBMITTED',
  network: 'eip155:84532',
  version: 2,
  auth_from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
  auth_to: '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
  auth_value: '10000',
  auth_valid_after: 0,
  auth_valid_before: 1999999999,
  auth_nonce: '0x' + 'cd'.repeat(32),
  transaction: null,
  submitted_at: 1735000000000,
  block_number: null,
  block_timestamp: null,
  confirmed_at: null,
  gas_used: null,
  retry_count: 0,
  last_retry_at: null,
  reconcile_notes: null,
  failure_reason: null,
  failure_detail: null,
}

describe('buildVerifyResponse', () => {
  it('populates canonical + X35 fields for SUBMITTED', () => {
    const r = buildVerifyResponse({ ...base, state: 'SUBMITTED' })
    expect(r.isValid).toBe(true)
    expect(r.payer).toBe(base.auth_from)
    expect(r.paymentId).toBe(base.payment_id)
    expect(r.requestId).toBe(base.request_id)
    expect(r.state).toBe('SUBMITTED')
    expect(r.invalidReason).toBeUndefined()
  })

  it('marks isValid=false with invalidReason on FAILED', () => {
    const r = buildVerifyResponse({
      ...base,
      state: 'FAILED',
      failure_reason: 'INVALID_SIGNATURE',
    })
    expect(r.isValid).toBe(false)
    expect(r.invalidReason).toBe('INVALID_SIGNATURE')
  })
})

describe('buildSettleResponse', () => {
  it('returns success=true on CONFIRMED with transaction + X35 extensions', () => {
    const r = buildSettleResponse({
      ...base,
      state: 'CONFIRMED',
      transaction: '0xdeadbeef',
      block_number: 42,
      block_timestamp: 1735000001,
      confirmed_at: 1735000002000,
      gas_used: '12345',
      reconcile_notes: 'distributeTx=0xcafe',
    })
    expect(r.success).toBe(true)
    expect(r.transaction).toBe('0xdeadbeef')
    expect(r.network).toBe('eip155:84532')
    expect(r.payer).toBe(base.auth_from)
    expect(r.amount).toBe('10000')
    expect(r.paymentId).toBe(base.payment_id)
    expect(r.requestId).toBe(base.request_id)
    expect(r.state).toBe('CONFIRMED')
    expect(r.receipt).toMatchObject({
      state: 'CONFIRMED',
      blockNumber: 42,
      reconcileNotes: 'distributeTx=0xcafe',
    })
  })

  it('returns success=false with errorReason on FAILED', () => {
    const r = buildSettleResponse({
      ...base,
      state: 'FAILED',
      failure_reason: 'TX_REVERTED',
      failure_detail: 'distribute reverted at block 10',
    })
    expect(r.success).toBe(false)
    expect(r.errorReason).toBe('TX_REVERTED')
  })

  it('carries the canonical amount field (not a Reckon402 rename)', () => {
    const r = buildSettleResponse({ ...base, state: 'CONFIRMED', transaction: '0xfeed' })
    expect(r.amount).toBe('10000')
    expect((r as unknown as { value?: string }).value).toBeUndefined()
  })
})
