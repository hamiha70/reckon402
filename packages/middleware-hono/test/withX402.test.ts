import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { withX402 } from '../src/withX402.js'
import type {
  Facilitator,
  FacilitatorVerifyResponse,
  FacilitatorSettleResponse,
  PaymentRequirements,
} from '@reckon402/types'

const NETWORK  = 'eip155:84532'
const USDC     = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const SPLITTER = '0x1111111111111111111111111111111111111111'
const BUYER    = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

// Lock-in pattern: the exact requirements the middleware must pass to the
// facilitator. If the middleware constructs different values, the facilitator
// enforces the wrong payment terms — these assertions catch that before
// any enforcement path exists.
//
// L3 note (Q-04-α in specs/04-l3-our-facilitator.md §5.1): payTo is now
// the Splitter address (not the seller EOA as at L2). Lock-in pattern
// is preserved; only the expected value changed.
const EXPECTED_REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SPLITTER,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

const VALID_AUTH = {
  from: BUYER,
  to: SPLITTER,
  value: '10000',
  validAfter: '0',
  validBefore: String(Math.floor(Date.now() / 1000) + 600),
  nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
}

const VALID_PAYLOAD = {
  x402Version: 2,
  accepted: { ...EXPECTED_REQUIREMENTS },
  payload: {
    signature: '0xabc',
    authorization: VALID_AUTH,
  },
}

const SETTLE_SUCCESS: FacilitatorSettleResponse = {
  success: true,
  transaction: '0xdeadbeef',
  network: NETWORK,
  payer: BUYER,
  paymentId: '0x' + 'cd'.repeat(32),
  requestId: '00000000-0000-4000-8000-000000000000',
  state: 'CONFIRMED',
}

function makeFacilitator(
  verifyResult: FacilitatorVerifyResponse,
  settleResult: FacilitatorSettleResponse = SETTLE_SUCCESS,
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
    recipient: SPLITTER,
    facilitator,
  }))
  app.get('/research', (c) => c.json({ ok: true }))
  return app
}

function makeRequest(headerName?: string, headerValue?: string) {
  const headers: Record<string, string> = {}
  if (headerName && headerValue) headers[headerName] = headerValue
  return new Request('https://agent.reckon402.com/research?q=test', { headers })
}

const encodePayload = (payload: unknown) => btoa(JSON.stringify(payload))

// ────────────────────────── 402 gate ──────────────────────────

describe('withX402 — 402 gate', () => {
  it('returns 402 when PAYMENT-SIGNATURE is absent', async () => {
    const f = makeFacilitator({ isValid: true })
    const res = await makeApp(f).fetch(makeRequest())
    expect(res.status).toBe(402)
    expect(((await res.json()) as { x402Version: number }).x402Version).toBe(2)
    expect(f.verify).not.toHaveBeenCalled()
    expect(f.settle).not.toHaveBeenCalled()
  })

  it('PAYMENT-REQUIRED header carries the exact merchant terms (payTo = Splitter at L3)', async () => {
    const res = await makeApp(makeFacilitator({ isValid: true })).fetch(makeRequest())
    const pr = res.headers.get('PAYMENT-REQUIRED')
    expect(pr).not.toBeNull()
    const decoded = JSON.parse(atob(pr!)) as {
      x402Version: number
      accepts: PaymentRequirements[]
    }
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts).toHaveLength(1)
    expect(decoded.accepts[0]).toEqual({
      ...EXPECTED_REQUIREMENTS,
      // extra matches on deep-equal; listed explicitly here for clarity.
    })
  })
})

// ────────────────────── header decoding ──────────────────────

describe('withX402 — header decoding', () => {
  it('returns 400 on non-base64 header', async () => {
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', 'not-valid-base64!!!'))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/base64/)
  })

  it('returns 400 when x402Version != 2', async () => {
    const payload = { ...VALID_PAYLOAD, x402Version: 1 }
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('UNSUPPORTED_VERSION')
  })

  it('returns 400 when payload.authorization is missing', async () => {
    const payload = { ...VALID_PAYLOAD, payload: { signature: '0xabc' } }
    const res = await makeApp(makeFacilitator({ isValid: true }))
      .fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/authorization/)
  })

  it('accepts x-payment as fallback alias', async () => {
    const f = makeFacilitator({ isValid: true })
    const res = await makeApp(f).fetch(makeRequest('x-payment', encodePayload(VALID_PAYLOAD)))
    expect(res.status).not.toBe(402)
    expect(f.verify).toHaveBeenCalled()
  })
})

// ─────────────────── validation before facilitator ───────────────────

describe('withX402 — validation before facilitator', () => {
  it('returns 402 DEADLINE_TOO_TIGHT when validBefore < now + 30s', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      payload: {
        ...VALID_PAYLOAD.payload,
        authorization: { ...VALID_AUTH, validBefore: String(Math.floor(Date.now() / 1000) + 10) },
      },
    }
    const f = makeFacilitator({ isValid: true })
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: string }).error).toBe('DEADLINE_TOO_TIGHT')
    expect(f.verify).not.toHaveBeenCalled()
  })

  it('returns 402 WRONG_NETWORK on mismatch', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      accepted: { ...VALID_PAYLOAD.accepted, network: 'eip155:8453' },
    }
    const f = makeFacilitator({ isValid: true })
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(payload)))
    expect(res.status).toBe(402)
    const body = await res.json() as { error: string; expected: string; got: string }
    expect(body.error).toBe('WRONG_NETWORK')
    expect(body.expected).toBe(NETWORK)
    expect(body.got).toBe('eip155:8453')
    expect(f.verify).not.toHaveBeenCalled()
  })
})

// ─────────────────── facilitator-contract lock-in ───────────────────

describe('withX402 — facilitator contract (EXPECTED_REQUIREMENTS lock-in)', () => {
  it('calls facilitator.verify with canonical requirements exactly', async () => {
    const f = makeFacilitator({ isValid: false, invalidReason: 'insufficient_funds' })
    await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))

    expect(f.verify).toHaveBeenCalledOnce()
    const [calledPayload, calledRequirements] = (f.verify as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, PaymentRequirements]
    expect(calledRequirements.amount).toBe('10000')
    expect(calledRequirements.payTo).toBe(SPLITTER)
    expect(calledRequirements.asset).toBe(USDC)
    expect(calledRequirements.network).toBe(NETWORK)
    expect(calledRequirements).toEqual(EXPECTED_REQUIREMENTS)
    expect((calledPayload as typeof VALID_PAYLOAD).x402Version).toBe(2)
  })

  it('calls facilitator.settle with the same requirements as verify', async () => {
    const f = makeFacilitator({ isValid: true })
    await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(f.settle).toHaveBeenCalledOnce()
    const [, settleRequirements] = (f.settle as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, PaymentRequirements]
    expect(settleRequirements).toEqual(EXPECTED_REQUIREMENTS)
  })

  it('returns 402 with invalidReason when verify fails', async () => {
    const f = makeFacilitator({ isValid: false, invalidReason: 'insufficient_funds' })
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: string }).error).toBe('insufficient_funds')
    expect(f.settle).not.toHaveBeenCalled()
  })

  it('does not call settle when verify fails', async () => {
    const f = makeFacilitator({ isValid: false, invalidReason: 'invalid_signature' })
    await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(f.settle).not.toHaveBeenCalled()
  })
})

// ──────────────────── success path ────────────────────

describe('withX402 — success path', () => {
  it('returns 200 with PAYMENT-RESPONSE carrying the settlement result', async () => {
    const f = makeFacilitator({ isValid: true, payer: BUYER }, SETTLE_SUCCESS)
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(200)
    const pr = res.headers.get('PAYMENT-RESPONSE')
    expect(pr).not.toBeNull()
    const decoded = JSON.parse(atob(pr!)) as FacilitatorSettleResponse
    expect(decoded.success).toBe(true)
    expect(decoded.transaction).toBe('0xdeadbeef')
    expect(decoded.network).toBe(NETWORK)
    expect(decoded.payer).toBe(BUYER)
    // X35 extensions carried through
    expect(decoded.paymentId).toBeDefined()
    expect(decoded.state).toBe('CONFIRMED')
  })

  it('passes through to the route handler after successful payment', async () => {
    const f = makeFacilitator({ isValid: true })
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

// ──────────────────── settle failure ────────────────────

describe('withX402 — settle failure', () => {
  it('returns 502 with errorReason when settle fails', async () => {
    const settleFailure: FacilitatorSettleResponse = {
      success: false,
      transaction: '',
      network: NETWORK,
      errorReason: 'tx_reverted',
    }
    const f = makeFacilitator({ isValid: true }, settleFailure)
    const res = await makeApp(f).fetch(makeRequest('payment-signature', encodePayload(VALID_PAYLOAD)))
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toBe('tx_reverted')
  })
})
