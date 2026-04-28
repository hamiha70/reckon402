import type { D1Database } from '@cloudflare/workers-types'
import { GatewayError } from '../lib/errors.js'

interface MerchantRow {
  ens_name: string
  enabled:  number
  records:  string  // JSON
}

/**
 * Read a single x402.* text-record value from the D1 merchants table.
 * Returns "" for an unknown key (ENS treats absent records as empty string).
 * Throws UNKNOWN_NAME if the merchant row is absent or disabled.
 */
export async function staticLookup(
  ensName: string,
  key: string,
  db: D1Database,
): Promise<string> {
  const row = await db
    .prepare('SELECT ens_name, enabled, records FROM merchants WHERE ens_name = ?')
    .bind(ensName)
    .first<MerchantRow>()

  if (!row || row.enabled === 0) {
    throw new GatewayError('UNKNOWN_NAME', `Merchant not found: ${ensName}`)
  }

  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(row.records)
  } catch {
    throw new GatewayError('INTERNAL_ERROR', `Corrupt records JSON for merchant: ${ensName}`)
  }

  return parsed[key] ?? ''
}
