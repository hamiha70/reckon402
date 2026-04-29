import { createPublicClient, http, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { SPLITTER_ABI } from '../abi/splitter.js'

/**
 * Resolves the ERC-8004 agentId for the seller served by this
 * facilitator's pinned Splitter. See specs/07-l4b-erc8004-writes.md
 * §4.3 for rationale.
 *
 * L4b₁ backend: read Splitter.getRecipient(0) to get the seller EOA
 * (slot 0 is seller by the L3 Splitter recipient convention —
 * specs/04-l3-our-facilitator.md §2.5), then look it up in the JSON-
 * encoded SELLER_AGENT_IDS map (lowercased addresses).
 *
 * Returns null on any resolution miss or config problem. Null is a
 * silent skip at the call site — never throws on config. This keeps
 * the attestation path from ever blocking a successful payment.
 *
 * v1.5 path: swap the map lookup for a per-merchant ENS
 * `x402.agent_id` text-record read inside this function. The return
 * shape and caller semantics stay the same.
 */
export interface AgentResolverEnv {
  SPLITTER_ADDRESS: string
  BASE_SEPOLIA_RPC_PRIMARY: string
  SELLER_AGENT_IDS: string
}

export async function resolveAgentId(env: AgentResolverEnv): Promise<bigint | null> {
  // Parse the JSON map first — if it's malformed, skip without a chain call.
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

  // Read seller EOA from Splitter slot 0.
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
    // Seller not in map — not attestable in this deployment. Silent skip.
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
