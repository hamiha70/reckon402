import { keccak256, encodeAbiParameters, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { canonicalRecordsString } from './set-ens-records.js'

const SIGNED_WRITE_CHAIN_ID = 11_155_111n

export interface SeedGatewayArgs {
  gatewayBaseUrl:   string
  ensName:          string
  chainId:          number            // 84532 for Base Sepolia
  agentId:          bigint
  records:          Record<string, string>
  onboardingPk:     `0x${string}`
}

export interface SeedGatewayResult {
  gatewayResponse:  { seeded: boolean; ensName: string; chainId: number; agentId: string; updatedAt: number }
  nonce:            Hex
}

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as Hex
}

function buildDigest(params: { ensName: string; key: string; value: string; nonce: Hex }): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: 'chainId', type: 'uint256' },
      { name: 'ensName', type: 'string' },
      { name: 'key',     type: 'string' },
      { name: 'value',   type: 'string' },
      { name: 'nonce',   type: 'bytes32' },
    ],
    [SIGNED_WRITE_CHAIN_ID, params.ensName, params.key, params.value, params.nonce],
  )
  return keccak256(encoded)
}

/**
 * Step 5 — POST /admin/bootstrap/gateway-seed to upsert the agent_id_index row
 * and (redundantly, idempotently) the merchants.records JSON. This wires the
 * gateway's L4a₂ ERC-8004 reputation reads to the SellingAgent.
 */
export async function seedGateway(
  args: SeedGatewayArgs,
  options: { fetch?: typeof fetch; nonce?: Hex } = {},
): Promise<SeedGatewayResult> {
  const fetchFn = options.fetch ?? fetch
  const nonce = options.nonce ?? randomNonce()
  const canon = canonicalRecordsString(args.records)
  const digestValue = `${args.chainId}:${args.agentId.toString()}:${canon}`

  const acct = privateKeyToAccount(args.onboardingPk)
  const digest = buildDigest({ ensName: args.ensName, key: 'gateway-seed', value: digestValue, nonce })
  const signature = await acct.sign({ hash: digest })

  const res = await fetchFn(`${args.gatewayBaseUrl}/admin/bootstrap/gateway-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ensName:   args.ensName,
      chainId:   args.chainId,
      agentId:   args.agentId.toString(),
      records:   args.records,
      nonce,
      signature,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`seed-gateway: gateway returned ${res.status} — ${text}`)
  }
  const body = await res.json() as { seeded: boolean; ensName: string; chainId: number; agentId: string; updatedAt: number }
  return { gatewayResponse: body, nonce }
}
