import type { Env } from '../env.js'
import { makeErc8004Reader, resolveAgentIdByEns } from '../erc8004/index.js'
import { applyPricingTier, isPricingKey } from './pricing.js'
import { staticLookup } from './records.js'

/**
 * Resolve a single x402.* text-record value for the given ENS name.
 *
 * Single modularity branch. When ENABLE_ERC8004_READS is true, the
 * if-branch (a) fetches the static base value, (b) resolves the ENS
 * name to an agentId via the D1 agent_id_index table, and (c) for
 * pricing keys, layers a reputation-tier discount on top. For any
 * other key, or when no agentId is indexed, the base value is
 * returned unchanged.
 *
 * No factories, no strategy interfaces — the contract is the return shape.
 */
export async function resolveRecord(
  ensName: string,
  key: string,
  env: Env,
): Promise<string> {
  if (env.ENABLE_ERC8004_READS === 'true') {
    const baseValue = await staticLookup(ensName, key, env.DB)
    if (!isPricingKey(key)) return baseValue
    const mapped = await resolveAgentIdByEns(ensName, env.DB)
    if (mapped === null) return baseValue // unknown-agent graceful fallback
    const reader = makeErc8004Reader(env)
    const summary = await reader.getReputationSummary(mapped.chainId, mapped.agentId)
    return applyPricingTier({ key, baseValue, summary })
  }
  return staticLookup(ensName, key, env.DB)
}
