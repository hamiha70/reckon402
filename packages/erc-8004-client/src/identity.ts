import type { Address, PublicClient, WalletClient, Hex } from 'viem'
import { IDENTITY_ABI } from './abis/identity.js'
import { requireIdentityAddress } from './multichain.js'
import { NoopCache, cacheKey, argDigest } from './cache.js'
import type { Agent, KVCache } from './types.js'

/** Default TTL for identity reads (seconds). */
const IDENTITY_TTL_S = 300

interface ReadArgs {
  chainId: number
  publicClient: PublicClient
  cache?: KVCache
  agentId: bigint
  ttlSeconds?: number
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

export const identity = {
  async ownerOf(args: ReadArgs): Promise<Address> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, ttlSeconds = IDENTITY_TTL_S } =
      args
    const contract = requireIdentityAddress(chainId)
    const key = cacheKey({ chainId, contract, fn: 'identity.ownerOf', args: await argDigest([agentId]) })
    return readCached<Address>(
      cache,
      key,
      ttlSeconds,
      async () =>
        publicClient.readContract({
          address: contract,
          abi: IDENTITY_ABI,
          functionName: 'ownerOf',
          args: [agentId],
        }) as Promise<Address>,
      (v) => v,
      (s) => s as Address,
    )
  },

  async tokenURI(args: ReadArgs): Promise<string> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, ttlSeconds = IDENTITY_TTL_S } =
      args
    const contract = requireIdentityAddress(chainId)
    const key = cacheKey({ chainId, contract, fn: 'identity.tokenURI', args: await argDigest([agentId]) })
    return readCached<string>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: IDENTITY_ABI,
          functionName: 'tokenURI',
          args: [agentId],
        }) as Promise<string>,
      (v) => v,
      (s) => s,
    )
  },

  async getAgentWallet(args: ReadArgs): Promise<Address> {
    const { chainId, publicClient, cache = new NoopCache(), agentId, ttlSeconds = IDENTITY_TTL_S } =
      args
    const contract = requireIdentityAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'identity.getAgentWallet',
      args: await argDigest([agentId]),
    })
    return readCached<Address>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: IDENTITY_ABI,
          functionName: 'getAgentWallet',
          args: [agentId],
        }) as Promise<Address>,
      (v) => v,
      (s) => s as Address,
    )
  },

  async getMetadata(args: ReadArgs & { metadataKey: string }): Promise<Hex> {
    const {
      chainId,
      publicClient,
      cache = new NoopCache(),
      agentId,
      metadataKey,
      ttlSeconds = IDENTITY_TTL_S,
    } = args
    const contract = requireIdentityAddress(chainId)
    const key = cacheKey({
      chainId,
      contract,
      fn: 'identity.getMetadata',
      args: await argDigest([agentId, metadataKey]),
    })
    return readCached<Hex>(
      cache,
      key,
      ttlSeconds,
      () =>
        publicClient.readContract({
          address: contract,
          abi: IDENTITY_ABI,
          functionName: 'getMetadata',
          args: [agentId, metadataKey],
        }) as Promise<Hex>,
      (v) => v,
      (s) => s as Hex,
    )
  },

  /** Composite helper: upstream has no getAgent function; we compose it. */
  async getAgent(args: ReadArgs): Promise<Agent> {
    const [owner, wallet, tokenURI] = await Promise.all([
      this.ownerOf(args),
      this.getAgentWallet(args),
      this.tokenURI(args),
    ])
    return { agentId: args.agentId, owner, wallet, tokenURI }
  },

  // --- writes (mocked in L4a₂ tests; real in L4b) ---

  async register(args: {
    chainId: number
    walletClient: WalletClient
    agentURI?: string
    metadata?: Array<{ metadataKey: string; metadataValue: Hex }>
  }): Promise<Hex> {
    const contract = requireIdentityAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')

    if (args.agentURI === undefined) {
      return args.walletClient.writeContract({
        address: contract,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: [],
        account,
        chain: null,
      })
    }
    if (args.metadata === undefined) {
      return args.walletClient.writeContract({
        address: contract,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: [args.agentURI],
        account,
        chain: null,
      })
    }
    return args.walletClient.writeContract({
      address: contract,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [args.agentURI, args.metadata],
      account,
      chain: null,
    })
  },

  async setAgentURI(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    newURI: string
  }): Promise<Hex> {
    const contract = requireIdentityAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: IDENTITY_ABI,
      functionName: 'setAgentURI',
      args: [args.agentId, args.newURI],
      account,
      chain: null,
    })
  },

  async setMetadata(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    metadataKey: string
    metadataValue: Hex
  }): Promise<Hex> {
    const contract = requireIdentityAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: IDENTITY_ABI,
      functionName: 'setMetadata',
      args: [args.agentId, args.metadataKey, args.metadataValue],
      account,
      chain: null,
    })
  },

  async setAgentWallet(args: {
    chainId: number
    walletClient: WalletClient
    agentId: bigint
    newWallet: Address
    deadline: bigint
    signature: Hex
  }): Promise<Hex> {
    const contract = requireIdentityAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: IDENTITY_ABI,
      functionName: 'setAgentWallet',
      args: [args.agentId, args.newWallet, args.deadline, args.signature],
      account,
      chain: null,
    })
  },
}
