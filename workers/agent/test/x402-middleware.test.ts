import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { withX402 } from '../src/x402-middleware.js'
import type { Facilitator, FacilitatorVerifyResponse, FacilitatorSettleResponse, PaymentRequirements } from '@reckon402/types'

const NETWORK = 'eip155:84532'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const BUYER = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

// The exact requirements the middleware should construct and pass to the facilitator.
// If the middleware passes different values, the facilitator will enforce wrong terms.
const EXPECTED_REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SELLER,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

const VALID_AUTHORIZATION = {
  from: BUYER,
  to: SELLER,
  value: '10000',
  validAfter: '0',
  validBefore: String(Math.floor(Date.now() / 1000) + 600),
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

const SETTLE_SUCCESS: FacilitatorSettleResponse = {
  success: true,
  transaction: '0xdeadbeef',
  network: NETWORK,
  payer: BUYER,
}

function makeFacilitator(
  verifyResult: FacilitatorVerifyResponse,
  settleResult: FacilitatorSettleResponse = SETTLE_SUCCESS
): Facilitator {
  return {
    verify: vi.fn().mockResolvedValue(verifyResult),
    settle: vi.fn().mockResolvedValue(settleResult),
  }
}

function makeApp(facilitator: Facilitator) {
  const app = new Hono()
  app.use('/research', withX402({
    amount: '10000',
    network: NETWORK,
    asset: USDC,
    recipient: SELLER,
    facilitator,
  }))
  app.get('/research', (c) => c.json({ ok: true }))
  return app
}

function makeRequest(headerName: string, headerValue: string): Request
function makeRequest(): Request
function makeRequest(headerName?: string, headerValue?: string) {
  const headers: Record<string, string> = {}
  if (headerName && headerValue) headers[headerName] = headerValue
  return new Request('https://agent.reckon402.com/research?q=test', { headers })
}

function encodePayload(payload: unknown) {
  return btoa(JSON.stringify(payload))
}

describe('x402 middleware — 402 gate', () => {
  it('returns 402 when PAYMENT-SIGNATURE is absent', async () => {
    const facilitator = makeFacilitator({ isValid: true })
    const res = await makeApp(facilitator).fetch(makeRequest())

    expect(res.status).toBe(402)
    const body = await res.json() as { x402Version: number }
    expect(body.x402Version).toBe(2)

    // Facilitator should never be called when no header is present
    expect(facilitator.verify).not.toHaveBeenCalled()
    expect(facilitator.settle).not.toHaveBeenCalled()
  })

  it('PAYMENT-REQUIRED header contains correct payment terms', async () => {
    const res = await makeApp(makeFacilitator({ isValid: true })).fetch(makeRequest())

    const prHeader = res.headers.get('PAYMENT-REQUIRED')
    expect(prHeader).not.toBeNull()

    const pr = JSON.parse(atob(prHeader!)) as {
      x402Version: number
      accepts: Array<{ network: string; amount: string; asset: string; payTo: string; scheme: string }>
    }
    expect(pr.x402Version).toBe(2)
    expect(pr.accepts).toHaveLength(1)
    expect(pr.accepts[0].network).toBe(NETWORK)
    expect(pr.accepts[0].amount).toBe('10000')
    expect(pr.accepts[0].asset).toBe(USDC)
    expect(pr.accepts[0].payTo).toBe(SELLER)
    expect(pr.accepts[0].scheme).toBe('exact')
  })
})

describe('x402 middleware — header decoding', () => {
  it('returns 400 when PAYMENT-SIGNATURE is not valid base64 JSON', async () => {
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', 'not-valid-base64!!!'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/base64/)
  })

  it('returns 400 when x402Version is not 2', async () => {
    const payload = { ...VALID_PAYLOAD, x402Version: 1 }
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('UNSUPPORTED_VERSION')
  })

  it('returns 400 when payload.authorization is missing', async () => {
    const payload = { ...VALID_PAYLOAD, payload: { signature: '0xabc' } }
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(/authorization/)
  })

  it('accepts x-payment as a fallback alias for PAYMENT-SIGNATURE', async () => {
    const facilitator = makeFacilitator({ isValid: true })
    const res = await makeApp(facilitator)
      .fetch(makeRequest('x-payment', encodePayload(VALID_PAYLOAD)))
    // Should reach facilitator.verify (not 402 gate) — may fail on network check but not on missing header
    expect(res.status).not.toBe(402)  // would be 402 only if header was missing entirely
    expect(facilitator.verify).toHaveBeenCalled()
  })
})

describe('x402 middleware — validation before facilitator', () => {
  it('returns 402 with DEADLINE_TOO_TIGHT when validBefore < now + 30s', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        authorization: { ...VALID_AUTHORIZATION, validBefore: String(Math.floor(Date.now() / 1000) + 10) },
      },
    }
    const facilitator = makeFacilitator({ isValid: true })
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(payload)))

    expect(res.status).toBe(402)
    expect((await res.json() as { error: string }).error).toBe('DEADLINE_TOO_TIGHT')
    // Deadline check is pre-facilitator — facilitator should not be called
    expect(facilitator.verify).not.toHaveBeenCalled()
  })

  it('returns 402 with WRONG_NETWORK when accepted.network does not match', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      accepted: { ...VALID_PAYLOAD.accepted, network: 'eip155:8453' },  // mainnet, not sepolia
    }
    const facilitator = makeFacilitator({ isValid: true })
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(payload)))

    expect(res.status).toBe(402)
    const body = await res.json() as { error: string; expected: string; got: string }
    expect(body.error).toBe('WRONG_NETWORK')
    expect(body.expected).toBe(NETWORK)
    expect(body.got).toBe('eip155:8453')
    expect(facilitator.verify).not.toHaveBeenCalled()
  })
})

describe('x402 middleware — facilitator contract', () => {
  it('calls facilitator.verify with the correct canonical requirements', async () => {
    const facilitator = makeFacilitator({ isValid: false, invalidReason: 'insufficient_funds' })
    await makeApp(facilitator).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(facilitator.verify).toHaveBeenCalledOnce()
    const [calledPayload, calledRequirements] = (facilitator.verify as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, PaymentRequirements]
    // Requirements passed to facilitator must encode the merchant's payment terms exactly.
    // If these are wrong, the facilitator enforces the wrong amount/recipient/asset.
    expect(calledRequirements.amount).toBe('10000')
    expect(calledRequirements.payTo).toBe(SELLER)
    expect(calledRequirements.asset).toBe(USDC)
    expect(calledRequirements.network).toBe(NETWORK)
    expect(calledRequirements).toEqual(EXPECTED_REQUIREMENTS)
    // Payload must be passed through intact
    expect((calledPayload as typeof VALID_PAYLOAD).x402Version).toBe(2)
  })

  it('calls facilitator.settle with the same requirements as verify', async () => {
    const facilitator = makeFacilitator({ isValid: true })
    await makeApp(facilitator).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(facilitator.settle).toHaveBeenCalledOnce()
    const [, settleRequirements] = (facilitator.settle as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, PaymentRequirements]
    expect(settleRequirements).toEqual(EXPECTED_REQUIREMENTS)
  })

  it('returns 402 with invalidReason when facilitator.verify returns isValid: false', async () => {
    const facilitator = makeFacilitator({ isValid: false, invalidReason: 'insufficient_funds' })
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(res.status).toBe(402)
    expect((await res.json() as { error: string }).error).toBe('insufficient_funds')
    // settle must not be called when verify fails
    expect(facilitator.settle).not.toHaveBeenCalled()
  })

  it('does not call settle when verify fails', async () => {
    const facilitator = makeFacilitator({ isValid: false, invalidReason: 'invalid_signature' })
    await makeApp(facilitator).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(facilitator.settle).not.toHaveBeenCalled()
  })
})

describe('x402 middleware — success path', () => {
  it('returns 200 with PAYMENT-RESPONSE header containing settlement result', async () => {
    const facilitator = makeFacilitator({ isValid: true, payer: BUYER }, SETTLE_SUCCESS)
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(res.status).toBe(200)

    const prResponse = res.headers.get('PAYMENT-RESPONSE')
    expect(prResponse).not.toBeNull()
    const decoded = JSON.parse(atob(prResponse!)) as FacilitatorSettleResponse
    expect(decoded.success).toBe(true)
    expect(decoded.transaction).toBe('0xdeadbeef')
    expect(decoded.network).toBe(NETWORK)
    expect(decoded.payer).toBe(BUYER)
  })

  it('passes through to the route handler after successful payment', async () => {
    const facilitator = makeFacilitator({ isValid: true })
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('x402 middleware — settle failure', () => {
  it('returns 502 with errorReason when facilitator.settle fails', async () => {
    const settleFailure: FacilitatorSettleResponse = {
      success: false,
      transaction: '',
      network: NETWORK,
      errorReason: 'tx_reverted',
    }
    const facilitator = makeFacilitator({ isValid: true }, settleFailure)
    const res = await makeApp(facilitator)
      .fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(res.status).toBe(502)
    expect((await res.json() as { error: string }).error).toBe('tx_reverted')
  })
})
