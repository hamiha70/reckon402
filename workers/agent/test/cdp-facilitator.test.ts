import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CdpFacilitator } from '../src/cdp-facilitator.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

const NETWORK = 'eip155:84532'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const BUYER = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

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
      from: BUYER,
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

  // ── verify ──────────────────────────────────────────────────────────────

  it('sends correct request body to /verify', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: true, payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    await new CdpFacilitator().verify(PAYLOAD, REQUIREMENTS)

    const [url, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x402.org/facilitator/verify')
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const body = JSON.parse(opts.body as string) as {
      x402Version: number
      paymentPayload: unknown
      paymentRequirements: unknown
    }
    // Wire format: x402Version at top level, payload and requirements wrapped
    expect(body.x402Version).toBe(2)
    expect(body.paymentPayload).toEqual(PAYLOAD)
    expect(body.paymentRequirements).toEqual(REQUIREMENTS)
  })

  it('maps a successful verify response to FacilitatorVerifyResponse', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: true, payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const result = await new CdpFacilitator().verify(PAYLOAD, REQUIREMENTS)

    expect(result.isValid).toBe(true)
    expect(result.payer).toBe(BUYER)
    expect(result.invalidReason).toBeUndefined()
  })

  it('maps a verify failure response with invalidReason', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: false, invalidReason: 'insufficient_funds', payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const result = await new CdpFacilitator().verify(PAYLOAD, REQUIREMENTS)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('insufficient_funds')
  })

  it('treats a non-2xx verify response as isValid: false with error details', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))

    const result = await new CdpFacilitator().verify(PAYLOAD, REQUIREMENTS)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toContain('facilitator_http_error:502')
  })

  // ── settle ──────────────────────────────────────────────────────────────

  it('sends correct request body to /settle', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ success: true, transaction: '0xdeadbeef', network: NETWORK, payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    await new CdpFacilitator().settle(PAYLOAD, REQUIREMENTS)

    const [url, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x402.org/facilitator/settle')
    const body = JSON.parse(opts.body as string) as { x402Version: number }
    expect(body.x402Version).toBe(2)
  })

  it('maps a successful settle response with transaction field name', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ success: true, transaction: '0xdeadbeef', network: NETWORK, payer: BUYER }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const result = await new CdpFacilitator().settle(PAYLOAD, REQUIREMENTS)

    expect(result.success).toBe(true)
    // Field name is `transaction`, NOT `txHash` — wire-compat invariant
    expect(result.transaction).toBe('0xdeadbeef')
    expect(result.network).toBe(NETWORK)
    expect(result.payer).toBe(BUYER)
  })

  it('maps a settle failure response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ success: false, transaction: '', network: NETWORK, errorReason: 'tx_reverted' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    const result = await new CdpFacilitator().settle(PAYLOAD, REQUIREMENTS)

    expect(result.success).toBe(false)
    expect(result.errorReason).toBe('tx_reverted')
    expect(result.transaction).toBe('')
  })

  it('treats a non-2xx settle response as success: false with error details', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    const result = await new CdpFacilitator().settle(PAYLOAD, REQUIREMENTS)

    expect(result.success).toBe(false)
    expect(result.errorReason).toContain('facilitator_http_error:500')
    expect(result.transaction).toBe('')
    expect(result.network).toBe(NETWORK)
  })

  // ── custom base URL ──────────────────────────────────────────────────────

  it('uses a custom baseUrl when provided', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ isValid: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))

    await new CdpFacilitator('https://facilitator.reckon402.com/').verify(PAYLOAD, REQUIREMENTS)

    const [url] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    // Trailing slash on constructor arg should be stripped
    expect(url).toBe('https://facilitator.reckon402.com/verify')
  })
})
