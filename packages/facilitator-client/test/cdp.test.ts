import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CdpFacilitator } from '../src/cdp.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const BUYER  = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SELLER,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

const payload: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: {
    signature: '0xabc',
    authorization: {
      from: BUYER, to: SELLER, value: '10000',
      validAfter: '0', validBefore: '1999999999',
      nonce: '0x' + 'aa'.repeat(32),
    },
  },
}

type FetchMock = ReturnType<typeof vi.fn>

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})
afterEach(() => { vi.restoreAllMocks() })

describe('CdpFacilitator.verify', () => {
  it('POSTs canonical body to /verify and maps response', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({ isValid: true, payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const client = new CdpFacilitator('https://x402.org/facilitator')
    const result = await client.verify(payload, requirements)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, init] = (globalThis.fetch as FetchMock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x402.org/facilitator/verify')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: requirements,
    })
    expect(result).toEqual({ isValid: true, payer: BUYER, invalidReason: undefined })
  })

  it('maps HTTP error to invalidReason', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      'boom', { status: 500 },
    ))
    const result = await new CdpFacilitator().verify(payload, requirements)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toMatch(/facilitator_http_error:500:boom/)
  })

  it('propagates isValid=false + invalidReason from body', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({ isValid: false, invalidReason: 'insufficient_funds' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const result = await new CdpFacilitator().verify(payload, requirements)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('insufficient_funds')
  })

  it('strips trailing slash from baseUrl', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({ isValid: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    await new CdpFacilitator('https://x402.org/facilitator/').verify(payload, requirements)
    const [url] = (globalThis.fetch as FetchMock).mock.calls[0] as [string]
    expect(url).toBe('https://x402.org/facilitator/verify')
  })
})

describe('CdpFacilitator.settle', () => {
  it('maps success body to FacilitatorSettleResponse with canonical fields', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({
        success: true,
        transaction: '0xdeadbeef',
        network: NETWORK,
        payer: BUYER,
        amount: '10000',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await new CdpFacilitator().settle(payload, requirements)
    expect(result).toEqual({
      success: true,
      transaction: '0xdeadbeef',
      network: NETWORK,
      payer: BUYER,
      errorReason: undefined,
      amount: '10000',
    })
  })

  it('returns success=false + errorReason on HTTP error', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      'nope', { status: 502 },
    ))
    const result = await new CdpFacilitator().settle(payload, requirements)
    expect(result.success).toBe(false)
    expect(result.errorReason).toMatch(/facilitator_http_error:502:nope/)
    expect(result.transaction).toBe('')
    expect(result.network).toBe(NETWORK)  // falls back to requirements.network
  })
})
