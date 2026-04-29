import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock viem's createPublicClient so the chain read is injectable.
// vi.hoisted ensures the spy exists before the vi.mock factory runs.
const { readContractSpy } = vi.hoisted(() => ({ readContractSpy: vi.fn() }))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: readContractSpy })),
  }
})

import { resolveAgentId } from '../src/treasury/agent-resolver.js'

const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const SPLITTER = '0x0ad507c6973eba86313794329ad9b12fbf24acd0'
const RPC = 'https://unused.local'

function baseEnv(overrides: Partial<{ SELLER_AGENT_IDS: string; SPLITTER_ADDRESS: string; BASE_SEPOLIA_RPC_PRIMARY: string }> = {}) {
  return {
    SPLITTER_ADDRESS: SPLITTER,
    BASE_SEPOLIA_RPC_PRIMARY: RPC,
    SELLER_AGENT_IDS: `{"${SELLER.toLowerCase()}":"1"}`,
    ...overrides,
  }
}

beforeEach(() => {
  readContractSpy.mockReset()
  vi.restoreAllMocks()
})

describe('resolveAgentId', () => {
  it('returns the agentId when the seller wallet is in the map', async () => {
    readContractSpy.mockResolvedValue([SELLER, 9700] as const)
    const id = await resolveAgentId(baseEnv())
    expect(id).toBe(1n)
    // Verify we read Splitter.getRecipient(0) — the L3 seller slot.
    expect(readContractSpy).toHaveBeenCalledOnce()
    const call = readContractSpy.mock.calls[0][0] as {
      address: string
      functionName: string
      args: unknown[]
    }
    expect(call.address).toBe(SPLITTER)
    expect(call.functionName).toBe('getRecipient')
    expect(call.args).toEqual([0])
  })

  it('is case-insensitive for map keys (map lowercased, seller uppercased from RPC)', async () => {
    // RPC often returns checksummed addresses; the map always stores lowercase.
    readContractSpy.mockResolvedValue([SELLER.toUpperCase(), 9700] as const)
    const env = baseEnv({ SELLER_AGENT_IDS: `{"${SELLER.toLowerCase()}":"42"}` })
    expect(await resolveAgentId(env)).toBe(42n)
  })

  it('returns null when the seller is not in the map (silent skip)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readContractSpy.mockResolvedValue(['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 9700] as const)
    expect(await resolveAgentId(baseEnv())).toBeNull()
    // Missing-from-map is NOT an error — it's a silent skip.
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('returns null + logs on malformed SELLER_AGENT_IDS JSON', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = baseEnv({ SELLER_AGENT_IDS: '{"not json' })
    expect(await resolveAgentId(env)).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    // Chain read must NOT happen when config is broken.
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  it('returns null + logs when SELLER_AGENT_IDS is a JSON array, not an object', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = baseEnv({ SELLER_AGENT_IDS: '["1","2"]' })
    expect(await resolveAgentId(env)).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    expect(readContractSpy).not.toHaveBeenCalled()
  })

  it('returns null + logs when the RPC read fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readContractSpy.mockRejectedValue(new Error('RPC_OUTAGE'))
    expect(await resolveAgentId(baseEnv())).toBeNull()
    expect(errSpy).toHaveBeenCalled()
  })

  it('returns null when the mapped value is not a valid bigint', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readContractSpy.mockResolvedValue([SELLER, 9700] as const)
    const env = baseEnv({ SELLER_AGENT_IDS: `{"${SELLER.toLowerCase()}":"not-a-number"}` })
    expect(await resolveAgentId(env)).toBeNull()
    expect(errSpy).toHaveBeenCalled()
  })
})
