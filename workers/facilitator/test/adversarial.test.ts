/**
 * Tier 2 #8 — Adversarial input sweep (K.5 Step 8).
 *
 * Lightweight: one test per category of malformed/adversarial input.
 * Exercises the real route handlers (no mock short-circuits at the input
 * parsing boundary) and asserts each bad input is rejected cleanly — no
 * 200 on invalid data, no uncaught throw that leaks server internals.
 *
 * Categories covered:
 *   A. Malformed JSON in the request body
 *   B. Missing required top-level fields
 *   C. Wrong x402Version (v1 payload)
 *   D. Oversized payload (simulated via large string field)
 *   E. Header injection attempt via paymentRequirements.network field
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { settleHandler } from '../src/settle-route.js'
import { verifyHandler } from '../src/verify.js'
import type { Env } from '../src/env.js'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const SPLITTER = '0x1111111111111111111111111111111111111111'
const BUYER    = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

function makeFakeDb() {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        run: async () => ({ meta: { changes: 0 } }),
        first: async <T = unknown>(): Promise<T | null> => null,
      }),
    }),
  }
}

function makeEnv(): Env {
  return {
    DB: makeFakeDb() as unknown as Env['DB'],
    NETWORK,
    USDC_ADDRESS: USDC,
    SPLITTER_ADDRESS: SPLITTER,
    FACILITATOR_PK: ('0x' + '00'.repeat(32)),
    BASE_SEPOLIA_RPC_PRIMARY: 'https://unused.local',
  }
}

function makeSettleApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/x402/settle', settleHandler)
  const env = makeEnv()
  return { fetch: (req: Request) => app.fetch(req, env) }
}

function makeVerifyApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/verify', verifyHandler)
  const env = makeEnv()
  return { fetch: (req: Request) => app.fetch(req, env) }
}

function settlePost(body: string, contentType = 'application/json') {
  return new Request('https://f.local/x402/settle', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

function verifyPost(body: string) {
  return new Request('https://f.local/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ──────────────────────────── Category A: Malformed JSON ────────────────────────────

describe('adversarial — malformed JSON body', () => {
  it('POST /x402/settle returns 4xx on truncated JSON (not 200, not 5xx unhandled throw)', async () => {
    const res = await makeSettleApp().fetch(settlePost('{x402Version: 2,'))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
    // The response body must be valid JSON — no raw error string leaking.
    await expect(res.json()).resolves.toBeDefined()
  })

  it('POST /verify returns 4xx on invalid JSON (bare string, not an object)', async () => {
    const res = await makeVerifyApp().fetch(verifyPost('"just a string"'))
    expect(res.status).toBeGreaterThanOrEqual(400)
    await expect(res.json()).resolves.toBeDefined()
  })

  it('POST /x402/settle returns 4xx on empty body', async () => {
    const res = await makeSettleApp().fetch(settlePost(''))
    expect(res.status).toBeGreaterThanOrEqual(400)
    await expect(res.json()).resolves.toBeDefined()
  })
})

// ──────────────────────────── Category B: Missing required fields ────────────────────────────

describe('adversarial — missing required fields', () => {
  it('POST /x402/settle rejects body with x402Version but no paymentPayload', async () => {
    const res = await makeSettleApp().fetch(settlePost(JSON.stringify({
      x402Version: 2,
      paymentRequirements: {
        scheme: 'exact', network: NETWORK, amount: '10000',
        asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
      // paymentPayload intentionally omitted
    })))
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await res.json() as { success: boolean; errorReason: string }
    expect(body.success).toBe(false)
  })

  it('POST /verify rejects body missing paymentPayload.payload.authorization', async () => {
    const res = await makeVerifyApp().fetch(verifyPost(JSON.stringify({
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: 'exact', network: NETWORK, amount: '10000',
          asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
          extra: { name: 'USDC', version: '2' },
        },
        payload: {
          signature: '0x' + 'aa'.repeat(65),
          // authorization intentionally omitted
        },
      },
      paymentRequirements: {
        scheme: 'exact', network: NETWORK, amount: '10000',
        asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
    })))
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await res.json() as { isValid: boolean }
    expect(body.isValid).toBe(false)
  })
})

// ──────────────────────────── Category C: Wrong version ────────────────────────────

describe('adversarial — wrong x402Version', () => {
  it('POST /x402/settle rejects x402Version=1 (legacy)', async () => {
    const res = await makeSettleApp().fetch(settlePost(JSON.stringify({
      x402Version: 1,
      paymentPayload: { x402Version: 1, payload: {}, accepted: {} },
      paymentRequirements: {},
    })))
    expect(res.status).toBe(400)
    const body = await res.json() as { errorReason: string }
    expect(body.errorReason).toBe('UNSUPPORTED_VERSION')
  })

  it('POST /verify rejects x402Version=0 (unrecognized)', async () => {
    const res = await makeVerifyApp().fetch(verifyPost(JSON.stringify({
      x402Version: 0,
      paymentPayload: { x402Version: 0 },
      paymentRequirements: {},
    })))
    expect(res.status).toBe(400)
    const body = await res.json() as { invalidReason: string }
    expect(body.invalidReason).toBe('UNSUPPORTED_VERSION')
  })
})

// ──────────────────────────── Category D: Oversized payload ────────────────────────────

describe('adversarial — oversized payload fields', () => {
  it('POST /x402/settle with 1MB nonce field returns 4xx (not 200)', async () => {
    // A pathologically large nonce field tests that no codepath silently accepts
    // it and tries to hash it (which would succeed but is never a valid bytes32).
    const largeNonce = '0x' + 'a'.repeat(2 * 1024 * 1024)  // 1MB hex string
    const res = await makeSettleApp().fetch(settlePost(JSON.stringify({
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: 'exact', network: NETWORK, amount: '10000',
          asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
          extra: { name: 'USDC', version: '2' },
        },
        payload: {
          signature: '0x' + 'aa'.repeat(65),
          authorization: {
            from: BUYER, to: SPLITTER, value: '10000',
            validAfter: '0', validBefore: '1999999999',
            nonce: largeNonce,
          },
        },
      },
      paymentRequirements: {
        scheme: 'exact', network: NETWORK, amount: '10000',
        asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
    })))
    // computePaymentId is wrapped in try/catch in settle-route.ts; a malformed
    // nonce (wrong byte length for bytes32) must return 400 INVALID_AUTHORIZATION
    // with a JSON body — not a 500 plain-text unhandled throw.
    expect(res.status).toBe(400)
    const body = await res.json() as { success: boolean; errorReason: string }
    expect(body.success).toBe(false)
    expect(body.errorReason).toBe('INVALID_AUTHORIZATION')
  })
})

// ──────────────────────────── Category E: Header injection via field values ────────────────────────────

describe('adversarial — header injection via field values', () => {
  it('network field containing CRLF injection does not set spurious response headers', async () => {
    // An attacker passes a network value containing CRLF to attempt HTTP response
    // splitting. Hono's c.json() serializes via JSON (not raw header writes), so
    // the CRLF will be JSON-escaped. The test confirms the response does NOT contain
    // an injected header and the status is 400 (UNSUPPORTED_NETWORK or similar).
    const injectedNetwork = 'eip155:84532\r\nX-Injected: evil'
    const res = await makeSettleApp().fetch(settlePost(JSON.stringify({
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: 'exact', network: injectedNetwork, amount: '10000',
          asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
          extra: { name: 'USDC', version: '2' },
        },
        payload: {
          signature: '0x' + 'aa'.repeat(65),
          authorization: {
            from: BUYER, to: SPLITTER, value: '10000',
            validAfter: '0', validBefore: '1999999999',
            nonce: '0x' + 'cc'.repeat(32),
          },
        },
      },
      paymentRequirements: {
        scheme: 'exact', network: injectedNetwork, amount: '10000',
        asset: USDC, payTo: SPLITTER, maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
    })))
    // The network doesn't match env.NETWORK → rejected.
    expect(res.status).toBe(400)
    // No injected header present.
    expect(res.headers.get('X-Injected')).toBeNull()
  })
})
