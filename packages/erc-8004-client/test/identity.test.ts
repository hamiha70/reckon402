import { describe, it, expect } from 'vitest'
import type { PublicClient } from 'viem'
import { identity, LruCache, requireIdentityAddress } from '../src/index.js'

/**
 * A minimal fake PublicClient that records every readContract call and
 * returns a canned response per functionName. Lets us assert the
 * library dispatches the correct address + function + args without
 * touching a live RPC.
 */
function makeFakePublic(responses: Record<string, unknown>): {
  client: PublicClient
  calls: Array<{ address: string; functionName: string; args: unknown[] }>
} {
  const calls: Array<{ address: string; functionName: string; args: unknown[] }> = []
  const client = {
    readContract: async (opts: any) => {
      calls.push({ address: opts.address, functionName: opts.functionName, args: opts.args ?? [] })
      if (!(opts.functionName in responses)) {
        throw new Error(`no mock for ${opts.functionName}`)
      }
      return responses[opts.functionName]
    },
  } as unknown as PublicClient
  return { client, calls }
}

describe('identity reads — mocked PublicClient', () => {
  it('ownerOf targets the correct Base Sepolia address + selector args', async () => {
    const { client, calls } = makeFakePublic({ ownerOf: '0x000000000000000000000000000000000000dEaD' })
    const out = await identity.ownerOf({ chainId: 84532, publicClient: client, agentId: 1n })
    expect(out).toBe('0x000000000000000000000000000000000000dEaD')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.address).toBe(requireIdentityAddress(84532))
    expect(calls[0]?.functionName).toBe('ownerOf')
    expect(calls[0]?.args).toEqual([1n])
  })

  it('tokenURI returns the stored URI string', async () => {
    const { client, calls } = makeFakePublic({ tokenURI: 'ipfs://bafybeigdyr...' })
    const out = await identity.tokenURI({ chainId: 84532, publicClient: client, agentId: 42n })
    expect(out).toBe('ipfs://bafybeigdyr...')
    expect(calls[0]?.functionName).toBe('tokenURI')
  })

  it('getAgentWallet returns zero-address when wallet unset', async () => {
    const { client } = makeFakePublic({ getAgentWallet: '0x0000000000000000000000000000000000000000' })
    const out = await identity.getAgentWallet({ chainId: 84532, publicClient: client, agentId: 1n })
    expect(out).toBe('0x0000000000000000000000000000000000000000')
  })

  it('getMetadata returns bytes value + passes metadataKey', async () => {
    const { client, calls } = makeFakePublic({ getMetadata: '0xdeadbeef' })
    const out = await identity.getMetadata({
      chainId: 84532,
      publicClient: client,
      agentId: 1n,
      metadataKey: 'x402.facilitator',
    })
    expect(out).toBe('0xdeadbeef')
    expect(calls[0]?.args).toEqual([1n, 'x402.facilitator'])
  })

  it('getAgent composite bundles ownerOf + getAgentWallet + tokenURI into one struct', async () => {
    const { client, calls } = makeFakePublic({
      ownerOf: '0x21fdEd74C901129977B8e28C2588595163E1e235',
      getAgentWallet: '0x0000000000000000000000000000000000000000',
      tokenURI: 'ipfs://...',
    })
    const out = await identity.getAgent({ chainId: 84532, publicClient: client, agentId: 1n })
    expect(out).toEqual({
      agentId: 1n,
      owner: '0x21fdEd74C901129977B8e28C2588595163E1e235',
      wallet: '0x0000000000000000000000000000000000000000',
      tokenURI: 'ipfs://...',
    })
    // Three calls; one per underlying read
    expect(calls.map((c) => c.functionName).sort()).toEqual(['getAgentWallet', 'ownerOf', 'tokenURI'])
  })

  it('cache deduplicates repeated reads within TTL', async () => {
    const { client, calls } = makeFakePublic({ tokenURI: 'ipfs://cached' })
    const cache = new LruCache()
    await identity.tokenURI({ chainId: 84532, publicClient: client, cache, agentId: 1n })
    await identity.tokenURI({ chainId: 84532, publicClient: client, cache, agentId: 1n })
    await identity.tokenURI({ chainId: 84532, publicClient: client, cache, agentId: 1n })
    expect(calls).toHaveLength(1) // second + third came from cache
  })

  it('throws UNSUPPORTED_CHAIN on unknown chainId', async () => {
    const { client } = makeFakePublic({})
    await expect(
      identity.ownerOf({ chainId: 99999, publicClient: client, agentId: 1n }),
    ).rejects.toThrow(/UNSUPPORTED_CHAIN/)
  })
})
