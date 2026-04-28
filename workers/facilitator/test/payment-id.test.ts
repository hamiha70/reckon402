import { describe, it, expect } from 'vitest'
import { computePaymentId } from '../src/payment-id.js'
// Cross-package identity check: facilitator re-exports buyer-sdk's
// computePaymentId, so they are the exact same function. This import
// confirms the re-export chain is intact — any refactor that breaks it
// (e.g. creating a divergent facilitator-side implementation) will fail here.
import { computePaymentId as buyerSdkComputePaymentId } from '@reckon402/buyer-sdk'
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

  it('is byte-identical to buyer-sdk export (single shared implementation, no cross-impl drift)', () => {
    // facilitator/src/payment-id.ts re-exports from @reckon402/buyer-sdk.
    // This test locks the invariant: they MUST be the same function and
    // produce the same bytes for every input. If they ever diverge, replay
    // protection breaks silently (buyer computes id_A, facilitator computes id_B,
    // D1 never sees a match → every call settles instead of replaying).
    expect(computePaymentId(fixture)).toBe(buyerSdkComputePaymentId(fixture))
    // Also verify across a varied input set.
    for (let i = 0; i < 20; ++i) {
      const auth: EIP3009Authorization = {
        ...fixture,
        value: String(i * 100),
        nonce: ('0x' + i.toString(16).padStart(64, '0')) as `0x${string}`,
      }
      expect(computePaymentId(auth)).toBe(buyerSdkComputePaymentId(auth))
    }
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

// ────────────────────── paymentId property fuzz (Tier 1 #4) ──────────────────────

describe('computePaymentId — property fuzz (≥50 structurally varied inputs)', () => {
  // Deterministic pseudo-random uint256 from a seed (no crypto.getRandomValues
  // needed — reproducibility across CI runs matters more than entropy here).
  function pseudoRandBigInt(seed: number): bigint {
    // xorshift64-inspired mixing
    let x = BigInt(seed + 1)
    x ^= x << 13n
    x ^= x >> 7n
    x ^= x << 17n
    x &= 0xFFFFFFFFFFFFFFFFn  // keep 64 bits
    // Stretch to 256 bits by repeating the mix.
    let r = 0n
    for (let i = 0; i < 4; i++) {
      x ^= x << 13n; x ^= x >> 7n; x ^= x << 17n; x &= 0xFFFFFFFFFFFFFFFFn
      r = (r << 64n) | x
    }
    return r
  }

  function uint256ToHex32(n: bigint): `0x${string}` {
    return ('0x' + (n & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn)
      .toString(16).padStart(64, '0')) as `0x${string}`
  }

  function pseudoAddress(seed: number): `0x${string}` {
    const n = pseudoRandBigInt(seed) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn
    return ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`
  }

  const ADDRESSES = [
    '0x837e30740a4A5bAC5480b4f707924469d42b43De',
    '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
    '0x0000000000000000000000000000000000000001',
    '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF',
    '0x1111111111111111111111111111111111111111',
  ] as const

  it('all ≥50 structurally varied inputs are deterministic (call twice → same result)', () => {
    const inputs: EIP3009Authorization[] = []

    // Group A: vary value (0, 1, max-uint256-approximation, powers of 2, large)
    const values = ['0', '1', '10000', '1000000', String(2n ** 96n - 1n), String(2n ** 128n - 1n)]
    for (const value of values) {
      inputs.push({ ...fixture, value })
    }

    // Group B: vary nonce (boundary values: all-zero, all-ff, sequential)
    const nonces = [
      '0x' + '00'.repeat(32),
      '0x' + 'ff'.repeat(32),
      '0x' + '01'.repeat(32),
      '0x' + 'ab'.repeat(32),
    ] as const
    for (const nonce of nonces) {
      inputs.push({ ...fixture, nonce })
    }

    // Group C: vary validAfter + validBefore (boundary: 0/max, near-expiry)
    const timeVariants: Array<{ validAfter: string; validBefore: string }> = [
      { validAfter: '0', validBefore: '1' },
      { validAfter: '0', validBefore: '1999999999' },
      { validAfter: '0', validBefore: String(2n ** 32n - 1n) },
      { validAfter: '1000000000', validBefore: '1000000600' },
    ]
    for (const t of timeVariants) {
      inputs.push({ ...fixture, ...t })
    }

    // Group D: vary from / to (known addresses + pseudo-random)
    for (let i = 0; i < 5; i++) {
      inputs.push({ ...fixture, from: ADDRESSES[i % ADDRESSES.length], to: ADDRESSES[(i + 1) % ADDRESSES.length] })
    }

    // Group E: pseudo-random full authorizations (cover collision + uniform spread)
    for (let seed = 0; seed < 31; seed++) {
      const n = pseudoRandBigInt(seed)
      inputs.push({
        from: pseudoAddress(seed),
        to: pseudoAddress(seed + 1000),
        value: String(n & 0xFFFFFFFFFFFFFFFFFFFFn),  // 80-bit random value
        validAfter: '0',
        validBefore: String(1999999999 + seed),
        nonce: uint256ToHex32(pseudoRandBigInt(seed + 2000)),
      })
    }

    expect(inputs.length).toBeGreaterThanOrEqual(50)

    // Every input: deterministic (two calls return the same bytes).
    for (const auth of inputs) {
      const a = computePaymentId(auth)
      const b = computePaymentId(auth)
      expect(a).toBe(b)
      expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    }
  })

  it('distinct inputs produce distinct paymentIds (collision resistance over 50 inputs)', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 50; seed++) {
      const auth: EIP3009Authorization = {
        from: pseudoAddress(seed),
        to: pseudoAddress(seed + 500),
        value: String(seed * 10000 + 1),
        validAfter: '0',
        validBefore: String(1999999999 + seed),
        nonce: uint256ToHex32(pseudoRandBigInt(seed + 100)),
      }
      const id = computePaymentId(auth)
      // Any collision here is a keccak256 pre-image collision — should never happen.
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
    expect(seen.size).toBe(50)
  })
})
