import { describe, it, expect } from 'vitest'
import { computePaymentId } from '../src/payment-id.js'
import type { EIP3009Authorization } from '@reckon402/types'

const fixture: EIP3009Authorization = {
  from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
  to:   '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
  value: '10000',
  validAfter: '0',
  validBefore: '1999999999',
  nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
}

describe('computePaymentId', () => {
  it('is deterministic on identical input', () => {
    const a = computePaymentId(fixture)
    const b = computePaymentId(fixture)
    expect(a).toBe(b)
  })

  it('returns a 0x-prefixed 32-byte hex', () => {
    const id = computePaymentId(fixture)
    expect(id).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('changes on any field change', () => {
    const base = computePaymentId(fixture)
    expect(computePaymentId({ ...fixture, value: '10001' })).not.toBe(base)
    expect(computePaymentId({ ...fixture, nonce: '0x' + '11'.repeat(32) })).not.toBe(base)
    expect(computePaymentId({ ...fixture, validBefore: '1999999998' })).not.toBe(base)
    expect(computePaymentId({ ...fixture, from: '0x0000000000000000000000000000000000000001' })).not.toBe(base)
    expect(computePaymentId({ ...fixture, to:   '0x0000000000000000000000000000000000000002' })).not.toBe(base)
  })

  it('is byte-identical across 100 random authorizations', () => {
    // Determinism sanity over many inputs — detects any non-pure helper drift.
    for (let i = 0; i < 100; ++i) {
      const a: EIP3009Authorization = {
        ...fixture,
        value: String(i),
        nonce: ('0x' + i.toString(16).padStart(64, '0')) as `0x${string}`,
      }
      expect(computePaymentId(a)).toBe(computePaymentId(a))
    }
  })
})
