import { createPublicClient, http, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { SPLITTER_ABI } from '../abi/splitter.js'

/**
 * Resolves the ERC-8004 agentId for the SellingAgent served by this
 * facilitator, for use on the attestation-write path.
 *
 * This module is the L4b₁ legacy resolver. L4c bypasses it entirely:
 * when `input.resolved` is present on the attestation path,
 * `attestation.ts` reads `resolved.agentId` directly (already validated
 * against the factory) and never consults this module. The legacy path
 * here is only reached when `USE_LEGACY_AGENT_RESOLVER === "true"`.
 *
 * L4b₁ backend: read `Splitter.getRecipient(0)` for the facilitator-pinned
 * Splitter to get the SellingAgent EOA, then look it up in the
 * JSON-encoded `SELLER_AGENT_IDS` map. Single-SellingAgent-per-
 * facilitator only. Kept behind the flag so L4b₁ regression fixtures
 * stay green while L4c lands.
 *
 * Returns null on any resolution miss or config problem. Null is a
 * silent skip at the call site — never throws on config. This keeps the
 * attestation path from ever blocking a successful payment.
 *
 * See specs/08a-l4c-factory-refactor.md §4.3 for rationale.
 */
export interface AgentResolverEnv {
  SPLITTER_ADDRESS: string
  BASE_SEPOLIA_RPC_PRIMARY: string
  SELLER_AGENT_IDS: string
}

export async function resolveAgentId(env: AgentResolverEnv): Promise<bigint | null> {
  let map: Record<string, string>
  try {
    map = JSON.parse(env.SELLER_AGENT_IDS) as Record<string, string>
    if (typeof map !== 'object' || map === null || Array.isArray(map)) {
      console.error('resolveAgentId_config: SELLER_AGENT_IDS not an object')
      return null
    }
  } catch (err) {
    console.error('resolveAgentId_config: SELLER_AGENT_IDS JSON parse failed', err)
    return null
  }

  let sellerWallet: Hex
  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(env.BASE_SEPOLIA_RPC_PRIMARY),
    })
    const result = (await publicClient.readContract({
      address: env.SPLITTER_ADDRESS as Hex,
      abi: SPLITTER_ABI,
      functionName: 'getRecipient',
      args: [0],
    })) as readonly [Hex, number]
    sellerWallet = result[0]
  } catch (err) {
    console.error('resolveAgentId_rpc: getRecipient(0) failed', err)
    return null
  }

  const key = sellerWallet.toLowerCase()
  const value = map[key]
  if (value === undefined) {
    // SellingAgent not in map — not attestable in this deployment. Silent skip.
    return null
  }

  try {
    const id = BigInt(value)
    if (id < 0n) return null
    return id
  } catch {
    console.error('resolveAgentId_config: agentId not parseable as bigint', { sellerWallet, value })
    return null
  }
}
