import type { D1Database } from '@cloudflare/workers-types'

/**
 * Cloudflare Worker bindings for the reckon402 gateway.
 *
 * Set at deploy time:
 * - DB: D1 binding (wrangler.toml [[d1_databases]])
 * - RESOLVER_CONTRACT_ADDRESS_SEPOLIA, ENABLE_ERC8004_READS, STEALTH_ENABLED: [vars]
 * - RECKON402_RESOLVER_SIGNER_PK, ETH_SEPOLIA_RPC_PRIMARY: wrangler secret put (from Infisical)
 */
export interface Env {
  DB: D1Database
  RESOLVER_CONTRACT_ADDRESS_SEPOLIA: string
  ENABLE_ERC8004_READS: string   // "false" in L4a₁
  STEALTH_ENABLED: string        // "false" always in hackathon build
  RECKON402_RESOLVER_SIGNER_PK: string  // 0x-prefixed 32-byte hex
  ETH_SEPOLIA_RPC_PRIMARY: string
}
