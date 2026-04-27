import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CdpFacilitator } from '../src/cdp-facilitator.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

const NETWORK = 'eip155:84532'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: 'exact',
    network: NETWORK,
    amount: '10000',
    asset: USDC,
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  },
  payload: {
    signature: '0xabc',
    authorization: {
      from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
      to: SELLER,
      value: '10000',
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 600),
      nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    },
  },
}

const REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SELLER,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

describe('CdpFacilitator', () => {
  const originalFetch = global.fetch
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = originalFetch })

  it('maps a successful verify response to FacilitatorVerifyResponse', async () => {
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: true, payer: PAYLOAD.payload.authorization.from }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const facilitator = new CdpFacilitator()
    const result = await facilitator.verify(PAYLOAD, REQUIREMENTS)

    expect(result.isValid).toBe(true)
    expect(result.payer).toBe(PAYLOAD.payload.authorization.from)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/verify')
    const body = JSON.parse(opts.body as string) as { x402Version: number }
    expect(body.x402Version).toBe(2)
  })

  it('maps a failed verify response with invalidReason', async () => {
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: false, invalidReason: 'insufficient_funds' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const facilitator = new CdpFacilitator()
    const result = await facilitator.verify(PAYLOAD, REQUIREMENTS)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('insufficient_funds')
  })

  it('maps a successful settle response to FacilitatorSettleResponse', async () => {
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce(new Response(
      JSON.stringify({
        success: true,
        transaction: '0xdeadbeef',
        network: NETWORK,
        payer: PAYLOAD.payload.authorization.from,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const facilitator = new CdpFacilitator()
    const result = await facilitator.settle(PAYLOAD, REQUIREMENTS)

    expect(result.success).toBe(true)
    expect(result.transaction).toBe('0xdeadbeef')
    expect(result.network).toBe(NETWORK)

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/settle')
  })
})
