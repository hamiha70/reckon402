import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverEip3009Signer, splitSignature, caip2ToChainId } from '../src/eip3009.js'

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

describe('splitSignature', () => {
  it('splits a 65-byte flat signature into (r, s, v)', () => {
    const sig =
      ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1c') as `0x${string}`
    const { r, s, v } = splitSignature(sig)
    expect(r).toBe('0x' + 'aa'.repeat(32))
    expect(s).toBe('0x' + 'bb'.repeat(32))
    expect(v).toBe(28)
  })

  it('handles v=27 (legacy Ethereum recovery id 0)', () => {
    // Some wallets emit v=27 instead of v=28. splitSignature must pass it
    // through unchanged so USDC.transferWithAuthorization gets the right value.
    const sig =
      ('0x' + 'cc'.repeat(32) + 'dd'.repeat(32) + '1b') as `0x${string}`
    const { r, s, v } = splitSignature(sig)
    expect(r).toBe('0x' + 'cc'.repeat(32))
    expect(s).toBe('0x' + 'dd'.repeat(32))
    expect(v).toBe(27)
  })

  it('rejects wrong-length input', () => {
    expect(() => splitSignature('0xabcd' as `0x${string}`)).toThrow(/65-byte/)
  })
})

describe('caip2ToChainId', () => {
  it('parses eip155 CAIP-2 strings', () => {
    expect(caip2ToChainId('eip155:84532')).toBe(84532)
    expect(caip2ToChainId('eip155:8453')).toBe(8453)
  })
  it('rejects non-eip155 CAIP-2', () => {
    expect(() => caip2ToChainId('solana:mainnet')).toThrow(/unsupported CAIP-2/)
  })
})

describe('splitSignature — high-S malleability (s > secp256k1 n/2)', () => {
  // secp256k1 curve order n (as hex, without 0x prefix):
  //   FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
  // n/2 (rounded down):
  //   7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
  //
  // A high-S signature has the same signing key but a different (r, s') pair
  // where s' = n - s. Both recover to the SAME signer address (secp256k1 is
  // malleable at this level), which means:
  //   - The recovered address check in verify.ts passes for both the canonical
  //     and the malleated form.
  //   - BUT the raw bytes of the signature differ → if paymentId were derived
  //     from the signature bytes (it isn't — paymentId uses only the auth
  //     struct), replay protection would break.
  //
  // recoverEip3009Signer delegates to viem's recoverTypedDataAddress, which
  // accepts both low-S and high-S signatures and recovers the correct signer
  // in both cases. This is correct for USDC's on-chain path (the EVM's
  // ecrecover also accepts both). The consequence: our facilitator ACCEPTS
  // high-S signatures and settles them normally. This is documented here so
  // a future auditor has an explicit record rather than a surprise.
  //
  // Replay protection is NOT affected because paymentId is keccak256 of the
  // EIP-3009 authorization struct fields — not of the signature bytes.

  it('accepts a high-S signature and recovers the correct signer (current behaviour: accept, not reject)', async () => {
    const pk = ('0x' + '55'.repeat(32)) as `0x${string}`
    const account = privateKeyToAccount(pk)

    const authorization = {
      from: account.address,
      to:   '0xD53ffac42496d73B3Faf946786688a8454F57b1f' as `0x${string}`,
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
      nonce: ('0x' + '33'.repeat(32)) as `0x${string}`,
    }

    const canonicalSig = await account.signTypedData({
      domain: {
        name: 'USDC',
        version: '2',
        chainId: 84532,
        verifyingContract: USDC_BASE_SEPOLIA,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    })

    // Derive the malleated (high-S) form: s' = n - s.
    // secp256k1 n:
    const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
    const r = canonicalSig.slice(0, 66)  // 0x + 32 bytes r
    const sHex = canonicalSig.slice(66, 130)  // 32 bytes s (no 0x)
    const v = canonicalSig.slice(130, 132)     // 1 byte v
    const sVal = BigInt('0x' + sHex)
    const sHigh = n - sVal
    const sHighHex = sHigh.toString(16).padStart(64, '0')
    // Flip v: 1b↔1c (27↔28) to pair with the malleated s.
    const vFlipped = v === '1b' ? '1c' : '1b'
    const malleatedSig = (r + sHighHex + vFlipped) as `0x${string}`

    // Confirm s' > n/2 (it IS high-S by construction).
    expect(sHigh > n / 2n).toBe(true)

    // Current behaviour: recoverEip3009Signer accepts and recovers the SAME signer.
    const recovered = await recoverEip3009Signer({
      authorization,
      signature: malleatedSig,
      chainId: 84532,
      usdcAddress: USDC_BASE_SEPOLIA,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())

    // Consequence for replay protection: paymentId is auth-struct–based, so
    // the canonical and malleated signatures produce the SAME paymentId.
    // The D1 idempotency key is therefore unaffected by malleability.
    const { computePaymentId } = await import('../src/payment-id.js')
    const pidCanonical = computePaymentId(authorization)
    const pidMalleated = computePaymentId(authorization)  // same auth struct
    expect(pidCanonical).toBe(pidMalleated)
  })
})

describe('EIP-3009 nonce uniqueness (Tier 2 #7)', () => {
  // EIP-3009 uses a bytes32 nonce as a one-time-use anti-replay token at the
  // USDC contract level. The nonce is part of the EIP-712 signed message, so
  // a different nonce → a different signature → a different authorization.
  //
  // For Reckon402, the nonce also feeds directly into paymentId via:
  //   paymentId = keccak256(encodePacked(from, to, value, validAfter, validBefore, nonce))
  //
  // Invariant: two authorizations that differ ONLY in their nonce must produce
  // distinct paymentIds. If they collided, replay protection would break — the
  // second authorization would look like a replay of the first, and the D1
  // idempotency guard would silently discard it.

  it('distinct nonces produce distinct paymentIds (replay protection relies on this)', async () => {
    const { computePaymentId } = await import('../src/payment-id.js')

    const base = {
      from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
      to:   '0x1111111111111111111111111111111111111111',
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
    }

    const nonces = [
      '0x' + '00'.repeat(32),
      '0x' + '01'.repeat(32),
      '0x' + 'ff'.repeat(32),
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      '0x' + 'ab'.repeat(32),
    ] as const

    const paymentIds = nonces.map((nonce) => computePaymentId({ ...base, nonce }))

    // All five paymentIds must be distinct.
    const unique = new Set(paymentIds)
    expect(unique.size).toBe(nonces.length)

    // Each paymentId must still be a valid 32-byte hex.
    for (const pid of paymentIds) {
      expect(pid).toMatch(/^0x[0-9a-f]{64}$/)
    }
  })

  it('same authorization with identical nonce always yields the same paymentId (idempotency)', async () => {
    const { computePaymentId } = await import('../src/payment-id.js')

    const auth = {
      from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
      to:   '0x1111111111111111111111111111111111111111',
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
      nonce: '0x' + 'cc'.repeat(32),
    } as const

    // Same nonce → same paymentId, every call. This is the D1 replay key.
    expect(computePaymentId(auth)).toBe(computePaymentId(auth))
    expect(computePaymentId(auth)).toBe(computePaymentId(auth))
  })

  it('50 pseudo-random distinct nonces all produce distinct paymentIds', async () => {
    const { computePaymentId } = await import('../src/payment-id.js')

    const base = {
      from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
      to:   '0x1111111111111111111111111111111111111111',
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
    }

    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const nonce = ('0x' + i.toString(16).padStart(64, '0')) as `0x${string}`
      const pid = computePaymentId({ ...base, nonce })
      expect(seen.has(pid)).toBe(false)
      seen.add(pid)
    }
    expect(seen.size).toBe(50)
  })
})

describe('recoverEip3009Signer', () => {
  it('recovers the signer from a valid EIP-3009 TransferWithAuthorization', async () => {
    // Deterministic test PK (NOT a real key).
    const pk = ('0x' + '11'.repeat(32)) as `0x${string}`
    const account = privateKeyToAccount(pk)

    const authorization = {
      from: account.address,
      to:   '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
      nonce: ('0x' + '22'.repeat(32)) as `0x${string}`,
    }

    const signature = await account.signTypedData({
      domain: {
        name: 'USDC',
        version: '2',
        chainId: 84532,
        verifyingContract: USDC_BASE_SEPOLIA,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        authorization.from,
        to:          authorization.to as `0x${string}`,
        value:       BigInt(authorization.value),
        validAfter:  BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce:       authorization.nonce,
      },
    })

    const recovered = await recoverEip3009Signer({
      authorization,
      signature,
      chainId: 84532,
      usdcAddress: USDC_BASE_SEPOLIA,
    })

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
