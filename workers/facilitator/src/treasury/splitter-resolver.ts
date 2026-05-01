import { createPublicClient, http, getAddress, isAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import { makeLogger } from '@reckon402/logger'

const log = makeLogger('splitter-resolver')

/**
 * L4c — per-payment splitter + agentId resolution.
 *
 * One facilitator serves N SellingAgents; each SellingAgent owns their own
 * Splitter deployed through the SplitterFactory. On every payment we fetch
 * the SellingAgent's `x402.splitter` + `x402.erc8004.agent_id` ENS text
 * records from the gateway and validate that the splitter address came
 * from our factory (guards against a forged ENS record pointing at an
 * unrelated contract).
 *
 * See specs/08a-l4c-factory-refactor.md §4.1.
 */

export interface SplitterResolverEnv {
  BASE_SEPOLIA_RPC_PRIMARY: string
  SPLITTER_FACTORY_ADDRESS: string
  GATEWAY_BASE_URL: string           // e.g. https://gateway.reckon402.com
  ERC8004_CHAIN_ID: string           // "84532" for Base Sepolia
}

export interface ResolvedSplitter {
  splitter: `0x${string}`
  agentId: bigint
  ensName: string
}

/**
 * Resolve the Splitter + agentId for a SellingAgent identified by ENS name.
 *
 * Reads via gateway flat-records endpoint:
 *   GET  {GATEWAY_BASE_URL}/records/{ensName}?flat=true&backend=static
 *   → { records: { "x402.splitter": "0x...", "x402.erc8004.agent_id": "1", ... } }
 *
 * Validates the splitter came from our SplitterFactory by calling
 * `SplitterFactory.isDeployed(splitter)`. Returns null on ANY failure
 * (missing record, malformed value, factory rejection, RPC error).
 * Null is a SOFT skip — the caller converts it to an explicit
 * SPLITTER_UNKNOWN state for the payment.
 *
 * Never throws. Logs structured errors instead.
 */
export async function resolveSplitterForPayment(
  env: SplitterResolverEnv,
  ensName: string,
): Promise<ResolvedSplitter | null> {
  // Single fetch — both records come from the flat-records endpoint.
  const records = await fetchAllRecords(env.GATEWAY_BASE_URL, ensName)
  const splitterRaw = records?.['x402.splitter']?.trim() || null
  const agentIdRaw  = records?.['x402.erc8004.agent_id']?.trim() || null
  if (!splitterRaw || !agentIdRaw) {
    log.warn('resolve_missing_record', { ensName, splitterRaw, agentIdRaw })
    return null
  }

  if (!isAddress(splitterRaw)) {
    log.warn('resolve_invalid_splitter_format', { ensName, splitterRaw })
    return null
  }
  const splitter = getAddress(splitterRaw) as `0x${string}`

  let agentId: bigint
  try {
    agentId = BigInt(agentIdRaw)
    if (agentId <= 0n) throw new Error('non-positive')
  } catch {
    log.warn('resolve_invalid_agent_id', { ensName, agentIdRaw })
    return null
  }

  const chainId = Number(env.ERC8004_CHAIN_ID)
  if (chainId !== 84532) {
    log.error('resolve_unsupported_chain', { chainId })
    return null
  }

  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(env.BASE_SEPOLIA_RPC_PRIMARY),
    })
    const deployed = await client.readContract({
      address: env.SPLITTER_FACTORY_ADDRESS as `0x${string}`,
      abi: FACTORY_ABI_MIN,
      functionName: 'isDeployed',
      args: [splitter],
    })
    if (!deployed) {
      log.warn('resolve_splitter_not_from_factory', { ensName, splitter })
      return null
    }
  } catch (err) {
    log.error('resolve_factory_rpc_error', {
      ensName,
      error: (err as Error).message,
    })
    return null
  }

  return { splitter, agentId, ensName }
}

async function fetchAllRecords(
  gatewayUrl: string,
  ensName: string,
): Promise<Record<string, string> | null> {
  // Use the flat-records endpoint — /lookup/:ensName/:key is the ABI-encoded
  // CCIP-Read path and cannot be called with a plain key name.
  const url =
    `${gatewayUrl}/records/${encodeURIComponent(ensName)}` +
    `?flat=true&backend=static`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return null
    const body = (await res.json()) as { records?: Record<string, string> } | null
    return body?.records ?? null
  } catch {
    return null
  }
}

const FACTORY_ABI_MIN = [
  {
    type: 'function',
    name: 'isDeployed',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
