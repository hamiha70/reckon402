import { createPublicClient, http, namehash, getAddress, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import type { D1Database } from '@cloudflare/workers-types'

// ENS Registry (Ethereum mainnet + Sepolia share the same address).
// Source: https://docs.ens.domains/contract-api-reference/ens
export const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const

export const OWNER_CACHE_TTL_MS = 60_000

const ENS_REGISTRY_ABI_MIN = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export interface OwnerLookupEnv {
  DB: D1Database
  ETH_SEPOLIA_RPC_PRIMARY: string
}

export interface OwnerCacheRow {
  owner_addr: string
  cached_at: number
}

/**
 * Resolve ENSRegistry.owner(namehash(ensName)) on Ethereum Sepolia, with a
 * 60s D1-backed cache (per spec §4.4). Returns null on any failure — malformed
 * name, RPC down, zero-address owner. Caller treats null as ACL-deny.
 *
 * Ownership rarely changes mid-session; a 60s lag is acceptable vs per-admin
 * RPC cost. If you need fresh state immediately after a setOwner tx, pass
 * `bypassCache: true`.
 */
export async function getEnsOwner(
  env: OwnerLookupEnv,
  ensName: string,
  opts: { bypassCache?: boolean; now?: number } = {},
): Promise<`0x${string}` | null> {
  const now = opts.now ?? Date.now()

  // Malformed-name guard — namehash throws on empty, but we want to return
  // null rather than surface viem's error to callers.
  if (!ensName || ensName.length === 0 || ensName.includes(' ')) {
    return null
  }

  // Cache read
  if (!opts.bypassCache) {
    try {
      const row = await env.DB
        .prepare('SELECT owner_addr, cached_at FROM ens_owner_cache WHERE ens_name = ?1')
        .bind(ensName)
        .first<OwnerCacheRow>()
      if (row && now - row.cached_at < OWNER_CACHE_TTL_MS) {
        return getAddress(row.owner_addr) as `0x${string}`
      }
    } catch {
      // Cache read failure is non-fatal; fall through to RPC.
    }
  }

  let node: Hex
  try {
    node = namehash(ensName)
  } catch {
    return null
  }

  let owner: `0x${string}`
  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(env.ETH_SEPOLIA_RPC_PRIMARY, { timeout: 10_000 }),
    })
    const raw = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ENS_REGISTRY_ABI_MIN,
      functionName: 'owner',
      args: [node],
    })
    owner = raw as `0x${string}`
  } catch {
    return null
  }

  if (!owner || owner === '0x0000000000000000000000000000000000000000') {
    return null
  }

  const normalized = getAddress(owner) as `0x${string}`

  // Cache write — best effort; swallow errors.
  try {
    await env.DB
      .prepare(
        `INSERT INTO ens_owner_cache (ens_name, owner_addr, cached_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(ens_name) DO UPDATE SET owner_addr = excluded.owner_addr, cached_at = excluded.cached_at`,
      )
      .bind(ensName, normalized, now)
      .run()
  } catch {
    // Non-fatal.
  }

  return normalized
}
