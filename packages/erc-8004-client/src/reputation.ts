import type { Address, PublicClient, WalletClient, Hex } from 'viem'
import { REPUTATION_ABI } from './abis/reputation.js'
import { requireReputationAddress } from './multichain.js'
import { NoopCache, cacheKey, argDigest } from './cache.js'
import type { FeedbackEntry, KVCache, ReputationSummary } from './types.js'

const REPUTATION_TTL_S = 300

interface CommonReadArgs {
  chainId: number
  publicClient: PublicClient
  cache?: KVCache
  ttlSeconds?: number
}

function serializeSummary(s: ReputationSummary): string {
  return JSON.stringify({ count: s.count.toString(), summaryValue: s.summaryValue.toString(), decimals: s.decimals })
}
function deserializeSummary(s: string): ReputationSummary {
  const o = JSON.parse(s) as { count: string; summaryValue: string; decimals: number }
  return { count: BigInt(o.count), summaryValue: BigInt(o.summaryValue), decimals: o.decimals }
}

export const reputation = {
  /**
   * Upstream ReputationRegistry.getSummary REVERTS when clientAddresses
   * is empty ("clientAddresses required"). If you want the aggregate over
   * all clients, use getSummaryForAllClients() which does the two-step
   * getClients → getSummary read.
   */
  async getSummary(args: CommonReadArgs & {
    agentId: bigint
    clientAddresses: Address[]
    tag1: string
    tag2: string
  }): Promise<ReputationSummary> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, clientAddresses, tag1, tag2, ttlSeconds = REPUTATION_TTL_S } = args
    if (clientAddresses.length === 0) {
      throw new Error('REPUTATION_SUMMARY_EMPTY_CLIENTS: upstream requires non-empty clientAddresses; use getSummaryForAllClients for aggregate reads')
    }
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.getSummary',
      args: await argDigest([agentId, clientAddresses, tag1, tag2]),
    })
    return readCached<ReputationSummary>(
      cache,
      key,
      ttlSeconds,
      async () => {
        const out = (await publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'getSummary',
          args: [agentId, clientAddresses, tag1, tag2],
        })) as readonly [bigint, bigint, number]
        return { count: out[0], summaryValue: out[1], decimals: out[2] }
      },
      serializeSummary,
      deserializeSummary,
    )
  },

  async getClients(args: CommonReadArgs & { agentId: bigint }): Promise<Address[]> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, ttlSeconds = REPUTATION_TTL_S } = args
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.getClients',
      args: await argDigest([agentId]),
    })
    return readCached<Address[]>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'getClients',
          args: [agentId],
        }) as Promise<Address[]>,
      (v) => JSON.stringify(v),
      (s) => JSON.parse(s) as Address[],
    )
  },

  /**
   * Aggregate-over-all-clients summary. Two-step read: getClients then
   * getSummary. Returns a zero-summary when the agent has no clients.
   */
  async getSummaryForAllClients(args: CommonReadArgs & {
    agentId: bigint
    tag1: string
    tag2: string
  }): Promise<ReputationSummary> {
    const clients = await this.getClients({
      chainId: args.chainId,
      publicClient: args.publicClient,
      cache: args.cache,
      agentId: args.agentId,
      ttlSeconds: args.ttlSeconds,
    })
    if (clients.length === 0) {
      return { count: 0n, summaryValue: 0n, decimals: 0 }
    }
    return this.getSummary({
      chainId: args.chainId,
      publicClient: args.publicClient,
      cache: args.cache,
      agentId: args.agentId,
      clientAddresses: clients,
      tag1: args.tag1,
      tag2: args.tag2,
      ttlSeconds: args.ttlSeconds,
    })
  },

  async getLastIndex(args: CommonReadArgs & { agentId: bigint; clientAddress: Address }): Promise<bigint> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, clientAddress, ttlSeconds = REPUTATION_TTL_S } = args
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.getLastIndex',
      args: await argDigest([agentId, clientAddress]),
    })
    return readCached<bigint>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'getLastIndex',
          args: [agentId, clientAddress],
        }) as Promise<bigint>,
      (v) => v.toString(),
      (s) => BigInt(s),
    )
  },

  async getResponseCount(args: CommonReadArgs & {
    agentId: bigint
    clientAddress: Address
    feedbackIndex: bigint
    responders: Address[]
  }): Promise<bigint> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, clientAddress, feedbackIndex, responders, ttlSeconds = REPUTATION_TTL_S } = args
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.getResponseCount',
      args: await argDigest([agentId, clientAddress, feedbackIndex, responders]),
    })
    return readCached<bigint>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'getResponseCount',
          args: [agentId, clientAddress, feedbackIndex, responders],
        }) as Promise<bigint>,
      (v) => v.toString(),
      (s) => BigInt(s),
    )
  },

  async readFeedback(args: CommonReadArgs & { agentId: bigint; clientAddress: Address; feedbackIndex: bigint }): Promise<FeedbackEntry> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, clientAddress, feedbackIndex, ttlSeconds = REPUTATION_TTL_S } = args
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.readFeedback',
      args: await argDigest([agentId, clientAddress, feedbackIndex]),
    })
    return readCached<FeedbackEntry>(
      cache,
      key,
      ttlSeconds,
      async () => {
        const out = (await publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'readFeedback',
          args: [agentId, clientAddress, feedbackIndex],
        })) as readonly [bigint, number, string, string, boolean]
        return {
          client: clientAddress,
          feedbackIndex,
          value: out[0],
          decimals: out[1],
          tag1: out[2],
          tag2: out[3],
          isRevoked: out[4],
        }
      },
      (v) =>
        JSON.stringify({
          ...v,
          feedbackIndex: v.feedbackIndex.toString(),
          value: v.value.toString(),
        }),
      (s) => {
        const o = JSON.parse(s) as Omit<FeedbackEntry, 'feedbackIndex' | 'value'> & { feedbackIndex: string; value: string }
        return { ...o, feedbackIndex: BigInt(o.feedbackIndex), value: BigInt(o.value) }
      },
    )
  },

  async readAllFeedback(args: CommonReadArgs & {
    agentId: bigint
    clientAddresses: Address[]
    tag1: string
    tag2: string
    includeRevoked: boolean
  }): Promise<FeedbackEntry[]> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, clientAddresses, tag1, tag2, includeRevoked, ttlSeconds = REPUTATION_TTL_S } = args
    if (clientAddresses.length === 0) {
      throw new Error('REPUTATION_READALL_EMPTY_CLIENTS: upstream requires non-empty clientAddresses')
    }
    const contract = requireReputationAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'reputation.readAllFeedback',
      args: await argDigest([agentId, clientAddresses, tag1, tag2, includeRevoked]),
    })
    return readCached<FeedbackEntry[]>(
      cache,
      key,
      ttlSeconds,
      async () => {
        const out = (await publicClient.readContract({
          address: contract,
          abi: REPUTATION_ABI,
          functionName: 'readAllFeedback',
          args: [agentId, clientAddresses, tag1, tag2, includeRevoked],
        })) as readonly [
          readonly Address[],
          readonly bigint[],
          readonly bigint[],
          readonly number[],
          readonly string[],
          readonly string[],
          readonly boolean[],
        ]
        const [clients, idxs, vals, decs, t1s, t2s, revs] = out
        return clients.map((c, i) => ({
          client: c,
          feedbackIndex: idxs[i]!,
          value: vals[i]!,
          decimals: decs[i]!,
          tag1: t1s[i]!,
          tag2: t2s[i]!,
          isRevoked: revs[i]!,
        }))
      },
      (v) =>
        JSON.stringify(
          v.map((e) => ({ ...e, feedbackIndex: e.feedbackIndex.toString(), value: e.value.toString() })),
        ),
      (s) => {
        const arr = JSON.parse(s) as Array<Omit<FeedbackEntry, 'feedbackIndex' | 'value'> & { feedbackIndex: string; value: string }>
        return arr.map((e) => ({ ...e, feedbackIndex: BigInt(e.feedbackIndex), value: BigInt(e.value) }))
      },
    )
  },

  // --- writes ---

  async giveFeedback(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    value: bigint
    valueDecimals: number
    tag1: string
    tag2: string
    endpoint: string
    feedbackURI: string
    feedbackHash: Hex
  }): Promise<Hex> {
    const contract = requireReputationAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: REPUTATION_ABI,
      functionName: 'giveFeedback',
      args: [
        args.agentId,
        args.value,
        args.valueDecimals,
        args.tag1,
        args.tag2,
        args.endpoint,
        args.feedbackURI,
        args.feedbackHash,
      ],
      account,
      chain: null,
    })
  },

  async revokeFeedback(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    feedbackIndex: bigint
  }): Promise<Hex> {
    const contract = requireReputationAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: REPUTATION_ABI,
      functionName: 'revokeFeedback',
      args: [args.agentId, args.feedbackIndex],
      account,
      chain: null,
    })
  },

  async appendResponse(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    clientAddress: Address
    feedbackIndex: bigint
    responseURI: string
    responseHash: Hex
  }): Promise<Hex> {
    const contract = requireReputationAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: REPUTATION_ABI,
      functionName: 'appendResponse',
      args: [args.agentId, args.clientAddress, args.feedbackIndex, args.responseURI, args.responseHash],
      account,
      chain: null,
    })
  },
}

async function readCached<T>(
  cache: KVCache,
  key: string,
  ttlSeconds: number,
  fetch: () => Promise<T>,
  serialize: (v: T) => string,
  deserialize: (s: string) => T,
): Promise<T> {
  const hit = await cache.get(key)
  if (hit !== null) return deserialize(hit)
  const fresh = await fetch()
  await cache.set(key, serialize(fresh), ttlSeconds)
  return fresh
}
