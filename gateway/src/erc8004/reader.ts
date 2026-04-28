import { createPublicClient, http, type PublicClient } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import type { D1Database } from '@cloudflare/workers-types'
import { reputation, identity, type ReputationSummary } from '@reckon402/erc-8004-client'
import type { Env } from '../env.js'
import { D1Erc8004Cache } from './cache.js'

interface AgentIndexRow {
  chain_id: number
  agent_id: number
}

export async function resolveAgentIdByEns(
  ensName: string,
  db: D1Database,
): Promise<{ chainId: number; agentId: bigint } | null> {
  const row = await db
    .prepare('SELECT chain_id, agent_id FROM agent_id_index WHERE ens_name = ?')
    .bind(ensName)
    .first<AgentIndexRow>()
  if (!row) return null
  return { chainId: row.chain_id, agentId: BigInt(row.agent_id) }
}

function makePublicClient(chainId: number, env: Env): PublicClient {
  if (chainId === 84532) {
    if (!env.BASE_SEPOLIA_RPC) throw new Error('BASE_SEPOLIA_RPC not configured')
    return createPublicClient({
      chain: baseSepolia,
      transport: http(env.BASE_SEPOLIA_RPC, { timeout: 10_000 }),
    }) as unknown as PublicClient
  }
  if (chainId === 8453) {
    if (!env.BASE_MAINNET_RPC) throw new Error('BASE_MAINNET_RPC not configured')
    return createPublicClient({
      chain: base,
      transport: http(env.BASE_MAINNET_RPC, { timeout: 10_000 }),
    }) as unknown as PublicClient
  }
  throw new Error(`UNSUPPORTED_CHAIN: chainId=${chainId}`)
}

function ttlSeconds(env: Env): number {
  const raw = env.CACHE_TTL_REPUTATION_S
  if (!raw) return 300
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300
}

/**
 * Gateway-side wrapper around the library. Owns the viem client
 * construction, the cache implementation, and the tag convention
 * ("payment"/"x402-settlement") per design doc §7.1.
 */
export class Erc8004Reader {
  constructor(private readonly env: Env) {}

  async getReputationSummary(chainId: number, agentId: bigint): Promise<ReputationSummary> {
    const publicClient = makePublicClient(chainId, this.env)
    const cache = new D1Erc8004Cache(this.env.DB)
    return reputation.getSummaryForAllClients({
      chainId,
      publicClient,
      cache,
      agentId,
      tag1: 'payment',
      tag2: 'x402-settlement',
      ttlSeconds: ttlSeconds(this.env),
    })
  }

  async getAgentTokenURI(chainId: number, agentId: bigint): Promise<string> {
    const publicClient = makePublicClient(chainId, this.env)
    const cache = new D1Erc8004Cache(this.env.DB)
    return identity.tokenURI({
      chainId,
      publicClient,
      cache,
      agentId,
      ttlSeconds: ttlSeconds(this.env),
    })
  }
}

export function makeErc8004Reader(env: Env): Erc8004Reader {
  return new Erc8004Reader(env)
}
