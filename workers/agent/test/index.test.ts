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

describe('GET /healthz', () => {
  it('returns 200 ok with full env-config probe shape on /healthz', async () => {
    const res = await fetchApp('/healthz')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      status: string
      layer: string
      checks: Record<string, { ok: boolean; reason?: string }>
      config: Record<string, string>
    }
    expect(body.status).toBe('ok')
    expect(body.layer).toBe('L3+L4d')
    expect(Object.keys(body.checks).sort()).toEqual([
      'amount', 'facilitator_url', 'gateway_url', 'network', 'seller_ens', 'splitter_address', 'usdc_address',
    ])
    for (const [_k, v] of Object.entries(body.checks)) expect(v.ok).toBe(true)
    expect(body.config.splitter_address).toBe(TEST_ENV.SPLITTER_ADDRESS)
    expect(body.config.seller_ens).toBe(TEST_ENV.SELLER_ENS)
    expect(body.config.gateway_base_url).toBe(TEST_ENV.GATEWAY_BASE_URL)
  })

  it('aliases legacy /health to the same handler shape (backward compat)', async () => {
    const res = await fetchApp('/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; layer: string }
    expect(body.status).toBe('ok')
    expect(body.layer).toBe('L3+L4d')
  })

  it('reports degraded when SPLITTER_ADDRESS is malformed', async () => {
    const broken = { ...TEST_ENV, SPLITTER_ADDRESS: 'not-an-address' }
    const res = await worker.fetch(
      new Request('https://agent.reckon402.com/healthz'),
      broken as never,
      {} as never,
    )
    expect(res.status).toBe(200)
    const body = await res.json() as {
      status: string
      checks: { splitter_address: { ok: boolean; reason?: string } }
    }
    expect(body.status).toBe('degraded')
    expect(body.checks.splitter_address.ok).toBe(false)
    expect(body.checks.splitter_address.reason).toBe('malformed')
  })
})

describe('GET /research', () => {
  it('returns 402 without PAYMENT-SIGNATURE header', async () => {
    const res = await fetchApp('/research?q=ethereum')
    expect(res.status).toBe(402)
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull()
  })

  it('PAYMENT-REQUIRED header carries payTo = SPLITTER_ADDRESS (L3 swap from seller EOA)', async () => {
    const res = await fetchApp('/research?q=ethereum')
    const pr = res.headers.get('PAYMENT-REQUIRED')
    expect(pr).not.toBeNull()
    const decoded = JSON.parse(atob(pr!)) as {
      x402Version: number
      accepts: Array<{ network: string; amount: string; asset: string; payTo: string; scheme: string }>
    }
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts).toHaveLength(1)
    expect(decoded.accepts[0].network).toBe(TEST_ENV.NETWORK)
    expect(decoded.accepts[0].amount).toBe(TEST_ENV.AMOUNT)
    expect(decoded.accepts[0].asset).toBe(TEST_ENV.USDC_ADDRESS)
    expect(decoded.accepts[0].payTo).toBe(TEST_ENV.SPLITTER_ADDRESS) // Q-04-α: Splitter, not seller
    expect(decoded.accepts[0].scheme).toBe('exact')
  })

  it('returns 400 when /research is reached with a valid payment but no q param', async () => {
    // Stub the facilitator so verify + settle both succeed; the middleware
    // advances to the route handler, which then 400s on missing q.
    ;(globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ isValid: true, payer: '0xabc' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          success: true,
          transaction: '0xdeadbeef',
          network: TEST_ENV.NETWORK,
          paymentId: '0x' + 'ab'.repeat(32),
          state: 'CONFIRMED',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
  
    const payload = {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: TEST_ENV.NETWORK,
        amount: TEST_ENV.AMOUNT,
        asset: TEST_ENV.USDC_ADDRESS,
        payTo: TEST_ENV.SPLITTER_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
      payload: {
        signature: '0x' + 'aa'.repeat(65),
        authorization: {
          from:  '0x837e30740a4A5bAC5480b4f707924469d42b43De',
          to:    TEST_ENV.SPLITTER_ADDRESS,
          value: '10000',
          validAfter:  '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 600),
          nonce: '0x' + 'cc'.repeat(32),
        },
      },
    }

    const res = await fetchApp('/research', {
      headers: { 'payment-signature': btoa(JSON.stringify(payload)) },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/q is required/)
  })

  it('posts to the configured FACILITATOR_URL (not CDP, not x402.org) on successful payment', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ isValid: true, payer: '0xabc' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          success: true,
          transaction: '0xdeadbeef',
          network: TEST_ENV.NETWORK,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      // third call: public RPC probe for chain-health response
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xc350f0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))

    const payload = {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: TEST_ENV.NETWORK,
        amount: TEST_ENV.AMOUNT,
        asset: TEST_ENV.USDC_ADDRESS,
        payTo: TEST_ENV.SPLITTER_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2' },
      },
      payload: {
        signature: '0x' + 'aa'.repeat(65),
        authorization: {
          from:  '0x837e30740a4A5bAC5480b4f707924469d42b43De',
          to:    TEST_ENV.SPLITTER_ADDRESS,
          value: '10000',
          validAfter:  '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 600),
          nonce: '0x' + 'dd'.repeat(32),
        },
      },
    }

    const res = await fetchApp('/research?q=test', {
      headers: { 'payment-signature': btoa(JSON.stringify(payload)) },
    })

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const urls = calls.map(([u]) => u)
    expect(urls).toContain(`${TEST_ENV.FACILITATOR_URL}/verify`)
    expect(urls).toContain(`${TEST_ENV.FACILITATOR_URL}/settle`)
    // Wire-compat invariant: only facilitator calls carry the canonical x402 wrapper.
    const facilitatorCalls = calls.filter(([u]) => (u as string).startsWith(TEST_ENV.FACILITATOR_URL))
    for (const [, init] of facilitatorCalls) {
      const body = JSON.parse(init.body as string)
      expect(body.x402Version).toBe(2)
      expect(body.paymentPayload).toBeDefined()
      expect(body.paymentRequirements).toBeDefined()
    }

    // Chain-health response shape
    const body = await res.json() as {
      query: string
      result: { chain: string; latestBlock: number; summary: string }
      meta: { paymentId: string | null; paidAt: string }
    }
    expect(body.query).toBe('test')
    expect(body.result.chain).toBe('Base Sepolia')
    expect(body.result.latestBlock).toBe(0xc350f0)
    expect(body.result.summary).toContain('Base Sepolia is healthy')
    expect(body.meta).toHaveProperty('paidAt')
  })
})
