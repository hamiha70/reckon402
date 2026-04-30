import type { D1Database } from '@cloudflare/workers-types'

/**
 * Cloudflare Worker bindings for the reckon402 gateway.
 *
 * Set at deploy time:
 * - DB: D1 binding (wrangler.toml [[d1_databases]])
 * - RESOLVER_CONTRACT_ADDRESS_SEPOLIA, ENABLE_ERC8004_READS, STEALTH_ENABLED,
 *   CACHE_TTL_REPUTATION_S: [vars]
 * - BASE_SEPOLIA_RPC, BASE_MAINNET_RPC: secret or [vars] depending on
 *   whether the RPC URL contains an API key
 * - RECKON402_RESOLVER_SIGNER_PK, ETH_SEPOLIA_RPC_PRIMARY,
 *   GATEWAY_CACHE_HOOK_TOKEN: wrangler secret put (from Infisical)
 */
export interface Env {
  DB: D1Database
  RESOLVER_CONTRACT_ADDRESS_SEPOLIA: string
  ENABLE_ERC8004_READS: string
  STEALTH_ENABLED: string
  RECKON402_RESOLVER_SIGNER_PK: string
  ETH_SEPOLIA_RPC_PRIMARY: string
  // L4a₂ additions:
  BASE_SEPOLIA_RPC: string
  BASE_MAINNET_RPC: string
  CACHE_TTL_REPUTATION_S: string
  GATEWAY_CACHE_HOOK_TOKEN: string
  // L4c additions:
  // Reckon402 onboarding EOA — the address authorized to sign /admin/bootstrap
  // and Reckon402-owned /admin/records writes. Set as a [vars] entry (not a
  // secret) since it's the public address, not the private key.
  RECKON402_ONBOARDING_EOA: string
}
