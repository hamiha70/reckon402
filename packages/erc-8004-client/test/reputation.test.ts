import { describe, it, expect } from 'vitest'
import type { PublicClient } from 'viem'
import { reputation, LruCache, requireReputationAddress } from '../src/index.js'

function makeFakePublic(responses: Record<string, unknown>): {
  client: PublicClient
  calls: Array<{ address: string; functionName: string; args: unknown[] }>
} {
  const calls: Array<{ address: string; functionName: string; args: unknown[] }> = []
  const client = {
    readContract: async (opts: any) => {
      calls.push({ address: opts.address, functionName: opts.functionName, args: opts.args ?? [] })
      if (!(opts.functionName in responses)) throw new Error(`no mock for ${opts.functionName}`)
      return responses[opts.functionName]
    },
  } as unknown as PublicClient
  return { client, calls }
}

describe('reputation reads — mocked PublicClient', () => {
  it('getSummary rejects empty clientAddresses (upstream-quirk guard)', async () => {
    const { client } = makeFakePublic({})
    await expect(
      reputation.getSummary({
        chainId: 84532,
        publicClient: client,
        agentId: 1n,
        clientAddresses: [],
        tag1: 'payment',
        tag2: 'x402-settlement',
      }),
    ).rejects.toThrow(/REPUTATION_SUMMARY_EMPTY_CLIENTS/)
  })

  it('getSummary decodes (count, summaryValue, decimals) tuple', async () => {
    const { client, calls } = makeFakePublic({ getSummary: [56n, 6348n, 2] })
    const out = await reputation.getSummary({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      clientAddresses: ['0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1'],
      tag1: '',
      tag2: '',
    })
    expect(out).toEqual({ count: 56n, summaryValue: 6348n, decimals: 2 })
    expect(calls[0]?.address).toBe(requireReputationAddress(84532))
    expect(calls[0]?.args[0]).toBe(1n)
    expect(calls[0]?.args[1]).toEqual(['0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1'])
  })

  it('getSummaryForAllClients short-circuits to zero when getClients is empty (no second call)', async () => {
    const { client, calls } = makeFakePublic({ getClients: [] as string[] })
    const out = await reputation.getSummaryForAllClients({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      tag1: '',
      tag2: '',
    })
    expect(out).toEqual({ count: 0n, summaryValue: 0n, decimals: 0 })
    expect(calls.map((c) => c.functionName)).toEqual(['getClients'])
  })

  it('getSummaryForAllClients chains getClients → getSummary with the list', async () => {
    const clientAddrs = ['0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1', '0xb0d39280Abd48F605459675142dc6243eb353270']
    const { client, calls } = makeFakePublic({
      getClients: clientAddrs,
      getSummary: [2n, 180n, 2],
    })
    const out = await reputation.getSummaryForAllClients({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      tag1: 'payment',
      tag2: 'x402-settlement',
    })
    expect(out).toEqual({ count: 2n, summaryValue: 180n, decimals: 2 })
    expect(calls.map((c) => c.functionName)).toEqual(['getClients', 'getSummary'])
    expect(calls[1]?.args[1]).toEqual(clientAddrs)
    expect(calls[1]?.args[2]).toBe('payment')
    expect(calls[1]?.args[3]).toBe('x402-settlement')
  })

  it('readFeedback decodes all 5 fields including isRevoked', async () => {
    const { client } = makeFakePublic({
      readFeedback: [100n, 2, 'payment', 'x402-settlement', true],
    })
    const out = await reputation.readFeedback({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      clientAddress: '0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1',
      feedbackIndex: 4n,
    })
    expect(out).toEqual({
      client: '0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1',
      feedbackIndex: 4n,
      value: 100n,
      decimals: 2,
      tag1: 'payment',
      tag2: 'x402-settlement',
      isRevoked: true,
    })
  })

  it('cache survives a two-step getSummaryForAllClients on the second call', async () => {
    const clientAddrs = ['0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1']
    const { client, calls } = makeFakePublic({
      getClients: clientAddrs,
      getSummary: [1n, 90n, 2],
    })
    const cache = new LruCache()
    await reputation.getSummaryForAllClients({
      chainId: 84532,
      publicClient: client,
      cache,
      agentId: 1n,
      tag1: '',
      tag2: '',
    })
    await reputation.getSummaryForAllClients({
      chainId: 84532,
      publicClient: client,
      cache,
      agentId: 1n,
      tag1: '',
      tag2: '',
    })
    // first call: 2 RPCs (getClients + getSummary); second: both cached
    expect(calls).toHaveLength(2)
  })

  it('readAllFeedback rejects empty clientAddresses', async () => {
    const { client } = makeFakePublic({})
    await expect(
      reputation.readAllFeedback({
        chainId: 84532,
        publicClient: client,
        agentId: 1n,
        clientAddresses: [],
        tag1: '',
        tag2: '',
        includeRevoked: false,
      }),
    ).rejects.toThrow(/REPUTATION_READALL_EMPTY_CLIENTS/)
  })

  it('readAllFeedback decodes parallel arrays into row objects', async () => {
    const out = [
      ['0xaa', '0xbb'],
      [1n, 2n],
      [100n, 200n],
      [2, 2],
      ['t1a', 't1b'],
      ['t2a', 't2b'],
      [false, true],
    ]
    const { client } = makeFakePublic({ readAllFeedback: out })
    const res = await reputation.readAllFeedback({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      clientAddresses: ['0xaa'],
      tag1: '',
      tag2: '',
      includeRevoked: true,
    })
    expect(res).toEqual([
      { client: '0xaa', feedbackIndex: 1n, value: 100n, decimals: 2, tag1: 't1a', tag2: 't2a', isRevoked: false },
      { client: '0xbb', feedbackIndex: 2n, value: 200n, decimals: 2, tag1: 't1b', tag2: 't2b', isRevoked: true },
    ])
  })
})
