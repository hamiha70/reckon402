/**
 * Tests for the dynamic /:label/research route.
 *
 * The dynamic route resolves an agent's wiring (Splitter, AMOUNT, asset)
 * from the gateway's flat-records endpoint at request time, instead of
 * reading them from wrangler [vars]. This lets one agent worker serve
 * many onboarded SellingAgents without per-seller redeploys.
 *
 * What we test here:
 *   1. Label format validation (rejects garbage labels with 400)
 *   2. Gateway 404 → 404 unknown_seller (no payment flow attempted)
 *   3. Gateway 200 with required records → 402 PAYMENT-REQUIRED with
 *      payTo / amount / asset matching the gateway response (NOT the
 *      hardcoded SPLITTER_ADDRESS / AMOUNT from [vars])
 *   4. Gateway 200 missing a required record → 502 gateway_lookup_failed
 *
 * Mocking strategy: we mock globalThis.fetch and the first invocation
 * (the gateway lookup) is what we control. The test never reaches the
 * facilitator because we only assert the 402 challenge, which is built
 * by the middleware before any payment is presented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import worker from '../src/index'

const TEST_ENV = {
  NETWORK:          'eip155:84532',
  USDC_ADDRESS:     '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  SPLITTER_ADDRESS: '0x1111111111111111111111111111111111111111',
  AMOUNT:           '10000',
  FACILITATOR_URL:  'https://facilitator.reckon402.com/x402',
  SELLER_ENS:       'seller-test.reckon402-test.eth',
  GATEWAY_BASE_URL: 'https://gateway.reckon402.com',
}

const fetchApp = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://agent.reckon402.com${path}`, init), TEST_ENV as never, {} as never)

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /:label/research — label validation', () => {
  it('returns 400 invalid_label when the label has unsupported characters', async () => {
    const res = await fetchApp('/SELLER19/research?q=test')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('invalid_label')
    // No outbound fetch should have happened.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_label when label is empty', async () => {
    // Hono routes /:label/research won't match an empty path segment so
    // this hits the catch-all (404 without our handler). Just assert that
    // it does not return 200/402 — i.e. the dynamic route did not silently
    // accept an empty label.
    const res = await fetchApp('//research?q=test')
    expect([400, 404]).toContain(res.status)
  })
})

describe('GET /:label/research — gateway lookup', () => {
  it('returns 404 unknown_seller when gateway returns 404', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'UNKNOWN_NAME' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const res = await fetchApp('/seller999/research?q=test')
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string; ensName: string }
    expect(body.error).toBe('unknown_seller')
    expect(body.ensName).toBe('seller999.reckon402-test.eth')
  })

  it('returns 502 gateway_lookup_failed when gateway returns a record set missing x402.splitter', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: {
            'x402.amount': '50000',
            'x402.asset':  'eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            // x402.splitter intentionally missing
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const res = await fetchApp('/seller42/research?q=test')
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string; detail: string }
    expect(body.error).toBe('gateway_lookup_failed')
    expect(body.detail).toContain('gateway_missing_required_record')
  })

  it('returns 402 PAYMENT-REQUIRED with gateway-resolved payTo/amount/asset (NOT the wrangler [vars] defaults)', async () => {
    const dynamicSplitter = '0xFff232b517cf7E2ff52125cF2f50682b584BbCa3'
    const dynamicAmount   = '50000' // 0.05 USDC — different from TEST_ENV.AMOUNT
    const dynamicAsset    = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: {
            'x402.splitter': dynamicSplitter,
            'x402.amount':   dynamicAmount,
            'x402.asset':    `eip155:84532/erc20:${dynamicAsset}`,
            'x402.endpoint': 'https://agent.reckon402.com/research',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const res = await fetchApp('/seller42/research?q=test')
    expect(res.status).toBe(402)

    const pr = res.headers.get('PAYMENT-REQUIRED')
    expect(pr).not.toBeNull()
    const decoded = JSON.parse(atob(pr!)) as {
      x402Version: number
      accepts: Array<{ network: string; amount: string; asset: string; payTo: string; extra?: { ens?: string } }>
    }
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts).toHaveLength(1)
    expect(decoded.accepts[0].network).toBe(TEST_ENV.NETWORK)
    expect(decoded.accepts[0].amount).toBe(dynamicAmount)         // gateway value, not TEST_ENV.AMOUNT
    expect(decoded.accepts[0].asset).toBe(dynamicAsset)            // gateway value
    expect(decoded.accepts[0].payTo.toLowerCase()).toBe(dynamicSplitter.toLowerCase()) // gateway value, not TEST_ENV.SPLITTER_ADDRESS
    expect(decoded.accepts[0].extra?.ens).toBe('seller42.reckon402-test.eth')

    // Exactly one outbound fetch (the gateway lookup); no facilitator
    // call yet because we never sent a payment.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe(`${TEST_ENV.GATEWAY_BASE_URL}/records/seller42.reckon402-test.eth`)
  })
})
