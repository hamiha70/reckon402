import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Reckon402Facilitator } from '../src/reckon402.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const SPLITTER = '0x1111111111111111111111111111111111111111'
const BUYER    = '0x837e30740a4A5bAC5480b4f707924469d42b43De'
const PAYMENT_ID = '0x' + 'ab'.repeat(32)
const REQUEST_ID = '00000000-0000-4000-8000-000000000000'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SPLITTER, // L3: Splitter, not seller EOA
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

const payload: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: {
    signature: '0xabc',
    authorization: {
      from: BUYER, to: SPLITTER, value: '10000',
      validAfter: '0', validBefore: '1999999999',
      nonce: '0x' + 'bb'.repeat(32),
    },
  },
}

type FetchMock = ReturnType<typeof vi.fn>

beforeEach(() => { globalThis.fetch = vi.fn() as unknown as typeof fetch })
afterEach(() => { vi.restoreAllMocks() })

describe('Reckon402Facilitator.verify', () => {
  it('POSTs canonical body to /verify and propagates X35 extensions', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({
        isValid: true,
        payer: BUYER,
        paymentId: PAYMENT_ID,
        requestId: REQUEST_ID,
        state: 'SUBMITTED',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const client = new Reckon402Facilitator('https://facilitator.reckon402.com/x402')
    const result = await client.verify(payload, requirements)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, init] = (globalThis.fetch as FetchMock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://facilitator.reckon402.com/x402/verify')
    const body = JSON.parse(init.body as string)
    expect(body.x402Version).toBe(2)
    expect(body.paymentPayload).toEqual(payload)
    expect(body.paymentRequirements).toEqual(requirements)

    expect(result.isValid).toBe(true)
    expect(result.payer).toBe(BUYER)
    expect(result.paymentId).toBe(PAYMENT_ID)
    expect(result.requestId).toBe(REQUEST_ID)
    expect(result.state).toBe('SUBMITTED')
  })

  it('maps HTTP 401 INVALID_SIGNATURE response', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      'signature recovery failed', { status: 401 },
    ))
    const result = await new Reckon402Facilitator().verify(payload, requirements)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toMatch(/facilitator_http_error:401/)
  })

  it('preserves invalidReason from a 200 body with isValid=false', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({ isValid: false, invalidReason: 'DEADLINE_TOO_TIGHT' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const result = await new Reckon402Facilitator().verify(payload, requirements)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('DEADLINE_TOO_TIGHT')
  })
})

describe('Reckon402Facilitator.settle', () => {
  it('maps success with X35 extensions including the receipt block', async () => {
    const serverResponse = {
      success: true,
      transaction: '0xdeadbeef',
      network: NETWORK,
      payer: BUYER,
      amount: '10000',
      paymentId: PAYMENT_ID,
      requestId: REQUEST_ID,
      state: 'CONFIRMED',
      receipt: {
        state: 'CONFIRMED',
        submittedAt: 1735000000000,
        confirmedAt: 1735000005000,
        blockNumber: 42,
        retryCount: 0,
        reconcileNotes: 'distributeTx=0xcafe',
      },
    }
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify(serverResponse),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await new Reckon402Facilitator().settle(payload, requirements)
    expect(result.success).toBe(true)
    expect(result.transaction).toBe('0xdeadbeef')
    expect(result.network).toBe(NETWORK)
    expect(result.payer).toBe(BUYER)
    expect(result.amount).toBe('10000')
    expect(result.paymentId).toBe(PAYMENT_ID)
    expect(result.state).toBe('CONFIRMED')
    expect((result.receipt as { reconcileNotes: string }).reconcileNotes).toBe('distributeTx=0xcafe')
  })

  it('uses the custom baseUrl (strips trailing slash)', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      JSON.stringify({
        success: true,
        transaction: '0x00',
        network: NETWORK,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    await new Reckon402Facilitator('https://localhost:8787/x402/').settle(payload, requirements)
    const [url] = (globalThis.fetch as FetchMock).mock.calls[0] as [string]
    expect(url).toBe('https://localhost:8787/x402/settle')
  })

  it('returns success=false + errorReason on HTTP 502', async () => {
    ;(globalThis.fetch as FetchMock).mockResolvedValue(new Response(
      'upstream timeout', { status: 502 },
    ))
    const result = await new Reckon402Facilitator().settle(payload, requirements)
    expect(result.success).toBe(false)
    expect(result.errorReason).toMatch(/facilitator_http_error:502/)
    expect(result.transaction).toBe('')
    expect(result.network).toBe(NETWORK)
  })
})
