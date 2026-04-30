import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist mocks so the factories can reference the spies.
const { readContractSpy } = vi.hoisted(() => ({ readContractSpy: vi.fn() }))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: readContractSpy })),
  }
})

import {
  resolveSplitterForPayment,
  type SplitterResolverEnv,
} from '../src/treasury/splitter-resolver.js'

const FACTORY  = '0x1111111111111111111111111111111111111111'
const SPLITTER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const GATEWAY  = 'https://gateway.reckon402.local'
const ENS      = 'alice.reckon402.eth'
const RPC      = 'https://rpc.reckon402.local'

function baseEnv(overrides: Partial<SplitterResolverEnv> = {}): SplitterResolverEnv {
  return {
    BASE_SEPOLIA_RPC_PRIMARY: RPC,
    SPLITTER_FACTORY_ADDRESS: FACTORY,
    GATEWAY_BASE_URL: GATEWAY,
    ERC8004_CHAIN_ID: '84532',
    ...overrides,
  }
}

function expectedLookupUrl(ens: string, key: string): string {
  return (
    `${GATEWAY}/lookup/${encodeURIComponent(ens)}/` +
    `${encodeURIComponent(key)}?backend=static`
  )
}

/**
 * Fetch stub that routes per-URL responses from a map. Every URL miss
 * fails the test — callers must enumerate the URLs they expect the
 * resolver to hit so assertions catch silent drift in the gateway
 * contract.
 */
function makeFetchStub(
  responses: Record<string, Response | (() => Response)>,
): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const entry = responses[url]
    if (entry === undefined) {
      throw new Error(`[test] unexpected fetch url: ${url}`)
    }
    return Promise.resolve(typeof entry === 'function' ? entry() : entry)
  }) as unknown as ReturnType<typeof vi.fn>
}

function jsonRes(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  readContractSpy.mockReset()
  vi.restoreAllMocks()
})

describe('resolveSplitterForPayment', () => {
  // ─────────────────────── Case 1: happy path ───────────────────────

  it('happy path — returns {splitter, agentId, ensName}; hits exact gateway URLs; calls isDeployed with exact address', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:        jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '42' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    readContractSpy.mockResolvedValue(true)

    const result = await resolveSplitterForPayment(baseEnv(), ENS)

    expect(result).not.toBeNull()
    // Splitter is returned in EIP-55 checksummed form (viem getAddress).
    const { getAddress } = await import('viem')
    expect(result!.splitter).toBe(getAddress(SPLITTER))
    expect(result!.splitter.toLowerCase()).toBe(SPLITTER.toLowerCase())
    expect(result!.agentId).toBe(42n)
    expect(result!.ensName).toBe(ENS)

    // Gateway URL assertions — exact match on both.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const urls = fetchSpy.mock.calls.map((c) => c[0])
    expect(urls).toContain(expectedLookupUrl(ENS, 'x402.splitter'))
    expect(urls).toContain(expectedLookupUrl(ENS, 'x402.erc8004.agent_id'))
    // Each call is a plain GET.
    for (const call of fetchSpy.mock.calls) {
      const opts = call[1] as RequestInit
      expect(opts.method).toBe('GET')
    }

    // Factory RPC assertion — exact contract + function + arg.
    expect(readContractSpy).toHaveBeenCalledOnce()
    const rpcCall = readContractSpy.mock.calls[0][0] as {
      address: string
      functionName: string
      args: unknown[]
    }
    expect(rpcCall.address).toBe(FACTORY)
    expect(rpcCall.functionName).toBe('isDeployed')
    expect(rpcCall.args).toEqual([result!.splitter])
  })

  // ─────────────────────── Case 2: 404 on splitter record ───────────────────────

  it('gateway 404 on splitter record → null; no factory RPC call', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         new Response('not found', { status: 404 }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '1' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 3: 404 on agent_id record ───────────────────────

  it('gateway 404 on agent_id record → null; no factory RPC call', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: new Response('nope', { status: 404 }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 4: malformed splitter ───────────────────────

  it('malformed splitter (not hex address) → null; no factory RPC call', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: 'not-an-address' }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '1' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 5: agent_id = "0" ───────────────────────

  it('agent_id = "0" → null (non-positive); no factory RPC call', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '0' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 6: non-numeric agent_id ───────────────────────

  it('agent_id non-numeric → null; no factory RPC call', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: 'abc' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 7: factory isDeployed returns false ───────────────────────

  it('factory isDeployed returns false (forged record) → null', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '1' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    readContractSpy.mockResolvedValue(false)

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).toHaveBeenCalledOnce()
    // Still asserts the exact args even on the reject path — the test
    // locks that we questioned the factory about the SAME address the
    // gateway returned.
    const rpcCall = readContractSpy.mock.calls[0][0] as { address: string; args: unknown[] }
    expect(rpcCall.address).toBe(FACTORY)
    expect((rpcCall.args[0] as string).toLowerCase()).toBe(SPLITTER.toLowerCase())
  })

  // ─────────────────────── Case 8: factory RPC throws ───────────────────────

  it('factory RPC throws → null; never re-throws', async () => {
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: SPLITTER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '1' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    readContractSpy.mockRejectedValue(new Error('RPC_OUTAGE'))

    // Must not throw — must resolve to null.
    await expect(resolveSplitterForPayment(baseEnv(), ENS)).resolves.toBeNull()
  })

  // ─────────────────────── Case 9: checksum normalization ───────────────────────

  it('normalizes a lowercase splitter to its checksum form', async () => {
    const LOWER = SPLITTER.toLowerCase() as `0x${string}`
    const fetchSpy = makeFetchStub({
      [expectedLookupUrl(ENS, 'x402.splitter')]:         jsonRes({ value: LOWER }),
      [expectedLookupUrl(ENS, 'x402.erc8004.agent_id')]: jsonRes({ value: '7' }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    readContractSpy.mockResolvedValue(true)

    // Import getAddress so the test encodes the exact normalization
    // contract, not a hand-computed checksum.
    const { getAddress } = await import('viem')
    const expected = getAddress(LOWER)

    const result = await resolveSplitterForPayment(baseEnv(), ENS)
    expect(result!.splitter).toBe(expected)
  })

  // ─────────────────────── Case 10: parallel fetch discipline ───────────────────────

  it('dispatches both fetches in parallel (both started before either resolves)', async () => {
    // Track the order in which fetches start vs. resolve. If the resolver
    // awaited sequentially, the second fetch would only start after the
    // first resolved — the `startedBeforeAnyResolved` invariant would
    // fail.
    let resolvedCount = 0
    const startOrder: string[] = []
    const resolveOrder: string[] = []

    function gated(url: string, body: unknown): () => Promise<Response> {
      return async () => {
        startOrder.push(url)
        await new Promise((r) => setTimeout(r, 10))
        resolvedCount++
        resolveOrder.push(url)
        return jsonRes(body)
      }
    }

    const splitterUrl = expectedLookupUrl(ENS, 'x402.splitter')
    const agentUrl    = expectedLookupUrl(ENS, 'x402.erc8004.agent_id')
    const splitterFn = gated(splitterUrl, { value: SPLITTER })
    const agentFn    = gated(agentUrl, { value: '1' })

    const fetchSpy = vi.fn((url: string) => {
      if (url === splitterUrl) return splitterFn()
      if (url === agentUrl)    return agentFn()
      throw new Error(`[test] unexpected fetch url: ${url}`)
    }) as unknown as ReturnType<typeof vi.fn>
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    readContractSpy.mockResolvedValue(true)

    const p = resolveSplitterForPayment(baseEnv(), ENS)
    // Immediately check: both fetches should have STARTED (startOrder.length === 2)
    // before either resolves (resolvedCount === 0), proving Promise.all dispatch.
    // Microtask flush to let both synchronous `fetch()` calls register.
    await Promise.resolve()
    await Promise.resolve()
    expect(startOrder.length).toBe(2)
    expect(resolvedCount).toBe(0)

    await p
    expect(resolveOrder.length).toBe(2)
  })
})
