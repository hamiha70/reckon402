import type { Env } from '../env.js'
import { staticLookup } from './records.js'

/**
 * Resolve a single x402.* text-record value for the given ENS name.
 *
 * Single modularity branch: when ENABLE_ERC8004_READS is true, throws
 * NOT_IMPLEMENTED (L4a₂ replaces that single line). Otherwise delegates
 * to the D1-backed static lookup.
 *
 * No factories, no strategy interfaces — the contract is the return shape.
 */
export async function resolveRecord(
  ensName: string,
  key: string,
  env: Env,
): Promise<string> {
  if (env.ENABLE_ERC8004_READS === 'true') {
    throw new Error('NOT_IMPLEMENTED — see L4a₂')
  }
  return staticLookup(ensName, key, env.DB)
}
