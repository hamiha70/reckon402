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

function expectedRecordsUrl(ens: string): string {
  return `${GATEWAY}/records/${encodeURIComponent(ens)}?flat=true&backend=static`
}

function recordsRes(records: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify({ records }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  readContractSpy.mockReset()
  vi.restoreAllMocks()
})

describe('resolveSplitterForPayment', () => {
  // ─────────────────────── Case 1: happy path ───────────────────────

  it('happy path — returns {splitter, agentId, ensName}; hits exact gateway URL; calls isDeployed with exact address', async () => {
    const fetchSpy = vi.fn((url: string) => {
      if (url === expectedRecordsUrl(ENS)) {
        return Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER, 'x402.erc8004.agent_id': '42' }))
      }
      throw new Error(`[test] unexpected fetch url: ${url}`)
    }) as unknown as typeof fetch
    globalThis.fetch = fetchSpy
    readContractSpy.mockResolvedValue(true)

    const result = await resolveSplitterForPayment(baseEnv(), ENS)

    expect(result).not.toBeNull()
    const { getAddress } = await import('viem')
    expect(result!.splitter).toBe(getAddress(SPLITTER))
    expect(result!.agentId).toBe(42n)
    expect(result!.ensName).toBe(ENS)

    // Single fetch to the flat-records endpoint.
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(expectedRecordsUrl(ENS))

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

  // ─────────────────────── Case 2: 404 on records endpoint ───────────────────────

  it('gateway 404 → null; no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('not found', { status: 404 }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 3: splitter record missing from response ───────────────────────

  it('splitter key absent from records → null; no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.erc8004.agent_id': '1' }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 4: agent_id record missing ───────────────────────

  it('agent_id key absent from records → null; no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 5: malformed splitter ───────────────────────

  it('malformed splitter (not hex address) → null; no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': 'not-an-address', 'x402.erc8004.agent_id': '1' }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 6: agent_id = "0" ───────────────────────

  it('agent_id = "0" → null (non-positive); no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER, 'x402.erc8004.agent_id': '0' }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 7: non-numeric agent_id ───────────────────────

  it('agent_id non-numeric → null; no factory RPC call', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER, 'x402.erc8004.agent_id': 'abc' }))
    ) as unknown as typeof fetch

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  // ─────────────────────── Case 8: factory isDeployed returns false ───────────────────────

  it('factory isDeployed returns false (forged record) → null', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER, 'x402.erc8004.agent_id': '1' }))
    ) as unknown as typeof fetch
    readContractSpy.mockResolvedValue(false)

    expect(await resolveSplitterForPayment(baseEnv(), ENS)).toBeNull()
    expect(readContractSpy).toHaveBeenCalledOnce()
    const rpcCall = readContractSpy.mock.calls[0][0] as { address: string; args: unknown[] }
    expect(rpcCall.address).toBe(FACTORY)
    expect((rpcCall.args[0] as string).toLowerCase()).toBe(SPLITTER.toLowerCase())
  })

  // ─────────────────────── Case 9: factory RPC throws ───────────────────────

  it('factory RPC throws → null; never re-throws', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': SPLITTER, 'x402.erc8004.agent_id': '1' }))
    ) as unknown as typeof fetch
    readContractSpy.mockRejectedValue(new Error('RPC_OUTAGE'))

    await expect(resolveSplitterForPayment(baseEnv(), ENS)).resolves.toBeNull()
  })

  // ─────────────────────── Case 10: checksum normalization ───────────────────────

  it('normalizes a lowercase splitter to its checksum form', async () => {
    const LOWER = SPLITTER.toLowerCase() as `0x${string}`
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(recordsRes({ 'x402.splitter': LOWER, 'x402.erc8004.agent_id': '7' }))
    ) as unknown as typeof fetch
    readContractSpy.mockResolvedValue(true)

    const { getAddress } = await import('viem')
    const expected = getAddress(LOWER)

    const result = await resolveSplitterForPayment(baseEnv(), ENS)
    expect(result!.splitter).toBe(expected)
  })
})
