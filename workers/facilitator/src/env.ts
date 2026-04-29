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

  // L4b₁ ERC-8004 attestation writes. See specs/07-l4b-erc8004-writes.md §4.
  ENABLE_ERC8004_WRITES: string                  // "true" | "false" (string-typed per wrangler [vars])
  ERC8004_CHAIN_ID: string                       // decimal string, e.g. "84532"
  // Seller-wallet → agentId map, JSON-encoded (`{"0xseller": "1", ...}`).
  // Resolution path at L4b₁: Splitter.getRecipient(0) gives the seller EOA
  // for this facilitator's pinned Splitter, looked up in this map. Single
  // entry for the hackathon demo; multi-entry scales to a multi-seller
  // facilitator. v1.5 swaps this for a per-merchant ENS text-record read
  // (`x402.agent_id`) inside the same `resolveAgentId()` function — no
  // call-site change needed. Keys are lowercased 0x-prefixed addresses.
  SELLER_AGENT_IDS: string
  GATEWAY_CACHE_HOOK_URL: string                 // full URL, e.g. "https://gateway.reckon402.com/hooks/cache-invalidate"
  GATEWAY_CACHE_HOOK_TOKEN?: string              // bearer token (secret); empty skips cache-invalidate
  ATTESTATION_FEEDBACK_URI_PREFIX: string        // produces feedbackURI = <prefix><paymentId>
}
