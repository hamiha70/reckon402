import { describe, it, expect } from 'vitest'
import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signPayment } from '../src/sign.js'
import { encodeXPaymentHeader, decodeXPaymentResponse } from '../src/encode.js'
import { computePaymentId } from '../src/payment-id.js'
import type { PaymentPayload, SettlementResponse } from '@reckon402/types'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

describe('signPayment', () => {
  it('produces a payload whose signature recovers to the buyer address', async () => {
    const privateKey = ('0x' + '11'.repeat(32)) as `0x${string}`
    const account = privateKeyToAccount(privateKey)

    const signed = await signPayment({
      privateKey,
      recipient: '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      amount: '10000',
      network: 'eip155:84532',
      usdcAddress: USDC,
      chainId: 84532,
    })

    expect(signed.payload.x402Version).toBe(2)
    expect(signed.payload.accepted.payTo).toBe('0xD53ffac42496d73B3Faf946786688a8454F57b1f')
    expect(signed.payload.accepted.amount).toBe('10000')
    expect(signed.payload.accepted.asset).toBe(USDC)
    expect(signed.payload.accepted.network).toBe('eip155:84532')

    const recovered = await recoverTypedDataAddress({
      domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: USDC },
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
        from: signed.authorization.from as `0x${string}`,
        to: signed.authorization.to as `0x${string}`,
        value: BigInt(signed.authorization.value),
        validAfter: BigInt(signed.authorization.validAfter),
        validBefore: BigInt(signed.authorization.validBefore),
        nonce: signed.authorization.nonce as `0x${string}`,
      },
      signature: signed.payload.payload.signature as `0x${string}`,
    })

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('exposes the paymentId computed from the signed authorization', async () => {
    const signed = await signPayment({
      privateKey: ('0x' + '22'.repeat(32)) as `0x${string}`,
      recipient: '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      amount: '10000',
      network: 'eip155:84532',
      usdcAddress: USDC,
      chainId: 84532,
    })
    expect(signed.paymentId).toBe(computePaymentId(signed.authorization))
  })

  it('produces a signature ≥ 30 seconds in the future (default)', async () => {
    const signed = await signPayment({
      privateKey: ('0x' + '33'.repeat(32)) as `0x${string}`,
      recipient: '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      amount: '10000',
      network: 'eip155:84532',
      usdcAddress: USDC,
      chainId: 84532,
    })
    const now = Math.floor(Date.now() / 1000)
    expect(Number(signed.authorization.validBefore) - now).toBeGreaterThanOrEqual(30)
  })
})

describe('encode / decode roundtrip', () => {
  it('encodeXPaymentHeader → JSON.parse(atob(...)) returns an equal payload', async () => {
    const signed = await signPayment({
      privateKey: ('0x' + '44'.repeat(32)) as `0x${string}`,
      recipient: '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      amount: '10000',
      network: 'eip155:84532',
      usdcAddress: USDC,
      chainId: 84532,
    })
    const header = encodeXPaymentHeader(signed.payload)
    expect(header).toMatch(/^[A-Za-z0-9+/=]+$/)
    const decoded = JSON.parse(atob(header)) as PaymentPayload
    expect(decoded).toEqual(signed.payload)
  })

  it('decodeXPaymentResponse parses a SettlementResponse with X35 extensions', () => {
    const settlement: SettlementResponse & { paymentId: string; state: string } = {
      success: true,
      transaction: '0xdeadbeef',
      network: 'eip155:84532',
      payer: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
      amount: '10000',
      paymentId: '0x' + 'ab'.repeat(32),
      state: 'CONFIRMED',
    }
    const encoded = btoa(JSON.stringify(settlement))
    const parsed = decodeXPaymentResponse(encoded) as typeof settlement
    expect(parsed.transaction).toBe('0xdeadbeef')
    expect(parsed.paymentId).toBe(settlement.paymentId)
    expect(parsed.state).toBe('CONFIRMED')
  })
})
