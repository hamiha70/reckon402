import type { D1Database } from '@cloudflare/workers-types'

/**
 * Cloudflare Worker bindings for the reckon402 facilitator.
 *
 * Set at deploy time:
 * - DB: D1 binding (wrangler.toml [[d1_databases]])
 * - NETWORK, USDC_ADDRESS: [vars] in wrangler.toml
 * - SPLITTER_ADDRESS: [vars] after the Splitter is deployed (commit 6)
 * - FACILITATOR_PK, BASE_SEPOLIA_RPC_PRIMARY, BASE_SEPOLIA_RPC_FALLBACK:
 *   set via `wrangler secret put` from Infisical-hydrated values
 */
export interface Env {
  DB: D1Database
  NETWORK: string                     // e.g. "eip155:84532"
  USDC_ADDRESS: string                // 0x-prefixed
  SPLITTER_ADDRESS: string            // 0x-prefixed; set after Splitter deploy
  FACILITATOR_PK: string              // 0x-prefixed 32-byte hex
  BASE_SEPOLIA_RPC_PRIMARY: string
  BASE_SEPOLIA_RPC_FALLBACK?: string
}
