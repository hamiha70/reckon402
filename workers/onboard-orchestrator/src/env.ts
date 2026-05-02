import type { D1Database } from '@cloudflare/workers-types'

/**
 * Worker bindings for the onboard-orchestrator.
 * [vars]:
 *   SPLITTER_FACTORY_ADDRESS, RECKON402_ONBOARDING_EOA, GATEWAY_BASE_URL,
 *   FACILITATOR_BASE_URL, CHAIN_ID_BASE_SEPOLIA
 *   L4d (optional, required when an onboarding request sets enableL4dEscrow=true):
 *     ESCROW_FACTORY_ADDRESS, TIER_STRATEGY_ADDRESS, FACILITATOR_FEE_EOA
 * secrets (wrangler secret put, via Infisical):
 *   ETH_SEPOLIA_RPC_PRIMARY, BASE_SEPOLIA_RPC_PRIMARY,
 *   ENS_FUNDER_PK, RECKON402_DEPLOYER_PK, RECKON402_ONBOARDING_PK
 * [[d1_databases]]: DB (shared with gateway — onboard_progress table is the
 *   only table this worker reads/writes; migration 0003 creates it)
 */
export interface Env {
  DB: D1Database

  // Configured addresses
  SPLITTER_FACTORY_ADDRESS:  string
  RECKON402_ONBOARDING_EOA:  string
  GATEWAY_BASE_URL:          string
  FACILITATOR_BASE_URL:      string
  CHAIN_ID_BASE_SEPOLIA:     string

  // L4d on-chain Escrow factory + per-deploy strategy + facilitator-fee EOA.
  // Optional at the binding level so the worker still loads when these are
  // not yet configured; the orchestrator throws a clean error if a request
  // sets enableL4dEscrow=true without these populated.
  ESCROW_FACTORY_ADDRESS?:   string
  TIER_STRATEGY_ADDRESS?:    string
  FACILITATOR_FEE_EOA?:      string

  // Secrets
  ETH_SEPOLIA_RPC_PRIMARY:   string
  BASE_SEPOLIA_RPC_PRIMARY:  string
  ENS_FUNDER_PK:             string
  RECKON402_DEPLOYER_PK:     string
  RECKON402_ONBOARDING_PK:   string
  FACILITATOR_ADMIN_TOKEN:   string  // proxied server-side for /receipts endpoint

  // Static assets binding (Workers Assets)
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
}
