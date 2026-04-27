import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { withX402 } from '../src/x402-middleware.js'
import type { Facilitator, FacilitatorVerifyResponse, FacilitatorSettleResponse } from '@reckon402/types'

const NETWORK = 'eip155:84532'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'

const VALID_AUTHORIZATION = {
  from: '0x837e30740a4A5bAC5480b4f707924469d42b43De',
  to: SELLER,
  value: '10000',
  validAfter: '0',
  validBefore: String(Math.floor(Date.now() / 1000) + 600),  // 10 min
  nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
}

const VALID_PAYLOAD = {
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
    authorization: VALID_AUTHORIZATION,
  },
}

function makeFacilitator(
  verifyResult: FacilitatorVerifyResponse,
  settleResult?: FacilitatorSettleResponse
): Facilitator {
  return {
    verify: vi.fn().mockResolvedValue(verifyResult),
    settle: vi.fn().mockResolvedValue(
      settleResult ?? {
        success: true,
        transaction: '0xtxhash',
        network: NETWORK,
        payer: VALID_AUTHORIZATION.from,
      }
    ),
  }
}

function makeApp(facilitator: Facilitator) {
  const app = new Hono()
  app.use('/research', withX402({ amount: '10000', network: NETWORK, asset: USDC, recipient: SELLER, facilitator }))
  app.get('/research', (c) => c.json({ ok: true }))
  return app
}

function makeRequest(headerValue?: string) {
  const headers: Record<string, string> = {}
  if (headerValue !== undefined) headers['payment-signature'] = headerValue
  return new Request('https://agent.reckon402.com/research?q=test', { headers })
}

function encodePayload(payload: unknown) {
  return btoa(JSON.stringify(payload))
}

describe('x402 middleware', () => {
  it('returns 402 with PAYMENT-REQUIRED header when PAYMENT-SIGNATURE is absent', async () => {
    const app = makeApp(makeFacilitator({ isValid: true }))
    const res = await app.fetch(makeRequest())
    expect(res.status).toBe(402)
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull()
    const body = await res.json() as { x402Version: number }
    expect(body.x402Version).toBe(2)
  })

  it('returns 400 when PAYMENT-SIGNATURE is not valid base64 JSON', async () => {
    const app = makeApp(makeFacilitator({ isValid: true }))
    const res = await app.fetch(makeRequest('not-valid-base64!!!'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/base64/)
  })

  it('returns 400 when x402Version is not 2', async () => {
    const app = makeApp(makeFacilitator({ isValid: true }))
    const payload = { ...VALID_PAYLOAD, x402Version: 1 }
    const res = await app.fetch(makeRequest(encodePayload(payload)))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('UNSUPPORTED_VERSION')
  })

  it('returns 402 when validBefore is less than 30s in the future', async () => {
    const app = makeApp(makeFacilitator({ isValid: true }))
    const payload = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        authorization: {
          ...VALID_AUTHORIZATION,
          validBefore: String(Math.floor(Date.now() / 1000) + 10),
        },
      },
    }
    const res = await app.fetch(makeRequest(encodePayload(payload)))
    expect(res.status).toBe(402)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('DEADLINE_TOO_TIGHT')
  })

  it('returns 402 with invalidReason when facilitator.verify returns isValid: false', async () => {
    const app = makeApp(makeFacilitator({ isValid: false, invalidReason: 'insufficient_funds' }))
    const res = await app.fetch(makeRequest(encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(402)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('insufficient_funds')
  })

  it('returns 200 with PAYMENT-RESPONSE header when verify+settle succeed', async () => {
    const settleResult: FacilitatorSettleResponse = {
      success: true,
      transaction: '0xdeadbeef',
      network: NETWORK,
      payer: VALID_AUTHORIZATION.from,
    }
    const app = makeApp(makeFacilitator({ isValid: true, payer: VALID_AUTHORIZATION.from }, settleResult))
    const res = await app.fetch(makeRequest(encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(200)
    const paymentResponse = res.headers.get('PAYMENT-RESPONSE')
    expect(paymentResponse).not.toBeNull()
    const decoded = JSON.parse(atob(paymentResponse!)) as { success: boolean; transaction: string }
    expect(decoded.success).toBe(true)
    expect(decoded.transaction).toBe('0xdeadbeef')
  })

  it('returns 502 when facilitator.settle fails', async () => {
    const settleResult: FacilitatorSettleResponse = {
      success: false,
      transaction: '',
      network: NETWORK,
      errorReason: 'tx_reverted',
    }
    const app = makeApp(makeFacilitator({ isValid: true }, settleResult))
    const res = await app.fetch(makeRequest(encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('tx_reverted')
  })
})
