import { keccak256, encodeAbiParameters, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const SIGNED_WRITE_CHAIN_ID = 11_155_111n // Ethereum Sepolia

export interface SetEnsRecordsArgs {
  gatewayBaseUrl:       string          // e.g. https://gateway.reckon402.com
  ensName:              string
  records:              Record<string, string>
  onboardingPk:         `0x${string}`   // Reckon402 onboarding key
}

export interface SetEnsRecordsResult {
  gatewayResponse:      { updated: boolean; ensName: string; keys: string[]; updatedAt: number }
  bootstrapNonce:       Hex
  externalLink:         string          // gateway records URL for UI link
}

/**
 * Canonicalize records → deterministic JSON string. Must match the gateway's
 * canonicalRecordsString (see gateway/src/routes/admin/bootstrap.ts).
 */
export function canonicalRecordsString(records: Record<string, string>): string {
  const keys = Object.keys(records).sort()
  const obj: Record<string, string> = {}
  for (const k of keys) obj[k] = records[k]!
  return JSON.stringify(obj)
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

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as Hex
}

/**
 * Step 4 — write merchant + infra records to the gateway via
 * POST /admin/bootstrap (signed by the Reckon402 onboarding key).
 *
 * This is the bootstrap window: ENS subnode ownership is still with the
 * funder/Reckon402 key, so Reckon402 is authorized to write SellingAgent-owned
 * keys (x402.amount, x402.pricing, x402.endpoint, …). After step 5
 * (seed-gateway) completes and the orchestrator issues the final setOwner
 * to transfer the subnode to the seller, this authorization narrows —
 * Reckon402 can only write infra keys on subsequent /admin/records calls.
 */
export async function setEnsRecords(
  args: SetEnsRecordsArgs,
  options: { fetch?: typeof fetch; nonce?: Hex } = {},
): Promise<SetEnsRecordsResult> {
  const fetchFn = options.fetch ?? fetch
  const nonce = options.nonce ?? randomNonce()
  const canon = canonicalRecordsString(args.records)

  const acct = privateKeyToAccount(args.onboardingPk)
  const digest = buildDigest({ ensName: args.ensName, key: 'bootstrap', value: canon, nonce })
  const signature = await acct.sign({ hash: digest })

  const res = await fetchFn(`${args.gatewayBaseUrl}/admin/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ensName: args.ensName,
      records: args.records,
      nonce,
      signature,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`set-ens-records: gateway returned ${res.status} — ${text}`)
  }
  const body = await res.json() as { updated: boolean; ensName: string; keys: string[]; updatedAt: number }

  return {
    gatewayResponse: body,
    bootstrapNonce:  nonce,
    externalLink:    `${args.gatewayBaseUrl}/lookup/${encodeURIComponent(args.ensName)}/x402.amount`,
  }
}
