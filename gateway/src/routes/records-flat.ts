import { type Context } from 'hono'
import type { Env } from '../env.js'
import { applyPricingTier, isPricingKey } from '../resolution/pricing.js'
import { makeErc8004Reader, resolveAgentIdByEns } from '../erc8004/index.js'
import type { D1Database } from '@cloudflare/workers-types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

interface MerchantRow {
  ens_name: string
  enabled:  number
  records:  string
}

async function fetchMerchantRecords(
  ensName: string,
  db: D1Database,
): Promise<Record<string, string> | null> {
  const row = await db
    .prepare('SELECT ens_name, enabled, records FROM merchants WHERE ens_name = ?')
    .bind(ensName)
    .first<MerchantRow>()
  if (!row || row.enabled === 0) return null
  try {
    return JSON.parse(row.records) as Record<string, string>
  } catch {
    return null
  }
}

function isValidEnsName(name: string): boolean {
  if (!name || name.length === 0) return false
  // Reject non-ASCII (codepoint > 0x7E or < 0x21)
  for (let i = 0; i < name.length; i++) {
    const cp = name.charCodeAt(i)
    if (cp < 0x21 || cp > 0x7e) return false
  }
  return true
}

export async function recordsFlatHandler(c: Context<{ Bindings: Env }>) {
  const ensName = c.req.param('ensName')
  const backend = c.req.query('backend') ?? 'static'

  if (!isValidEnsName(ensName)) {
    return c.json({ error: { code: 'MALFORMED_NAME', message: 'Invalid ENS name' } }, 422, CORS_HEADERS)
  }

  const baseRecords = await fetchMerchantRecords(ensName, c.env.DB)
  if (baseRecords === null) {
    return c.json({ error: { code: 'UNKNOWN_NAME', message: `Merchant not found: ${ensName}` } }, 404, CORS_HEADERS)
  }

  if (backend !== 'erc8004') {
    return c.json({ records: baseRecords }, 200, CORS_HEADERS)
  }

  // ERC-8004 path: apply pricing tier to pricing keys
  const mapped = await resolveAgentIdByEns(ensName, c.env.DB)
  if (mapped === null) {
    return c.json({ records: baseRecords }, 200, CORS_HEADERS)
  }

  const reader  = makeErc8004Reader(c.env)
  const summary = await reader.getReputationSummary(mapped.chainId, mapped.agentId)

  const discounted: Record<string, string> = { ...baseRecords }
  for (const key of Object.keys(discounted)) {
    if (isPricingKey(key)) {
      discounted[key] = applyPricingTier({
        key: key as 'x402.amount' | 'x402.pricing',
        baseValue: discounted[key],
        summary,
      })
    }
  }

  return c.json({ records: discounted }, 200, CORS_HEADERS)
}

export async function recordsFlatOptions(c: Context<{ Bindings: Env }>) {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
