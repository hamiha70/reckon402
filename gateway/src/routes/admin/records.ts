import type { Context } from 'hono'
import type { Env } from '../../env.js'
import { recoverSignedWriteSigner, sameAddress } from './auth.js'
import { requiredWriter } from '../../lib/acl.js'
import { getEnsOwner } from '../../ens/owner-lookup.js'

interface RecordsBody {
  ensName?:   unknown
  key?:       unknown
  value?:     unknown
  nonce?:     unknown
  signature?: unknown
}

const MAX_VALUE_BYTES = 2048  // defensive cap; ENS text records are short

/**
 * POST /admin/records — signed-write endpoint for a single x402.* text record.
 *
 * Flow (spec 08B §4.1):
 *  1. Validate shape
 *  2. Recover signer from (chainId, ensName, key, value, nonce) digest
 *  3. Lookup required writer for the key in the ACL
 *  4. If Reckon402 role required → signer must be RECKON402_ONBOARDING_EOA
 *     If SellingAgent role required → signer must be owner(namehash(ensName))
 *     Bootstrap window: if owner(node) == Reckon402 EOA, Reckon402 may also
 *     write SellingAgent keys (spec §4.2 one-way door)
 *  5. Insert replay-guard row (UNIQUE(ens_name, nonce) → 409 on collision)
 *  6. Mutate merchants.records JSON in place
 *  7. Return 200
 */
export async function adminRecordsHandler(c: Context<{ Bindings: Env }>) {
  let body: RecordsBody
  try {
    body = (await c.req.json()) as RecordsBody
  } catch {
    return c.json({ error: 'malformed_json' }, 400)
  }

  const ensName   = typeof body.ensName   === 'string' ? body.ensName   : null
  const key       = typeof body.key       === 'string' ? body.key       : null
  const value     = typeof body.value     === 'string' ? body.value     : null
  const nonce     = typeof body.nonce     === 'string' ? body.nonce     : null
  const signature = typeof body.signature === 'string' ? body.signature : null

  if (!ensName || !key || value === null || !nonce || !signature) {
    return c.json({ error: 'malformed_body' }, 422)
  }
  if (ensName.length === 0 || ensName.length > 253 || !ensName.includes('.')) {
    return c.json({ error: 'malformed_ens_name' }, 422)
  }
  if (value.length === 0 || value.length > MAX_VALUE_BYTES) {
    return c.json({ error: 'malformed_value' }, 422)
  }

  const writer = requiredWriter(key)
  if (!writer) {
    return c.json({ error: 'unknown_key', key }, 422)
  }

  const signer = await recoverSignedWriteSigner({
    ensName,
    key,
    value,
    nonce:     nonce as `0x${string}`,
    signature: signature as `0x${string}`,
  })
  if (!signer) {
    return c.json({ error: 'invalid_signature' }, 401)
  }

  // ACL enforcement
  const reckon402Eoa = c.env.RECKON402_ONBOARDING_EOA
  if (!reckon402Eoa) {
    return c.json({ error: 'onboarding_eoa_not_configured' }, 503)
  }

  const isReckon402 = sameAddress(signer, reckon402Eoa)

  let authorized = false
  if (writer === 'Reckon402') {
    authorized = isReckon402
  } else {
    // SellingAgent key: signer must be the current ENS owner.
    const owner = await getEnsOwner(c.env, ensName)
    if (!owner) {
      return c.json({ error: 'ens_owner_unavailable' }, 503)
    }
    if (sameAddress(signer, owner)) {
      authorized = true
    } else if (isReckon402 && sameAddress(owner, reckon402Eoa)) {
      // Bootstrap window — Reckon402 still owns the subnode.
      authorized = true
    }
  }

  if (!authorized) {
    return c.json({ error: 'forbidden', writer, signer }, 403)
  }

  // Replay guard + audit insert
  const writtenAt = Date.now()
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO record_updates
           (ens_name, record_key, record_value, nonce, signer_addr, written_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(ensName, key, value, nonce, signer, writtenAt)
      .run()
  } catch (err) {
    // UNIQUE(ens_name, nonce) collision → replay
    const msg = (err as Error).message ?? ''
    if (msg.toLowerCase().includes('unique')) {
      return c.json({ error: 'replay', nonce }, 409)
    }
    return c.json({ error: 'db_error' }, 500)
  }

  // Mutate merchants.records JSON in place. Row must exist — onboarding
  // bootstrap creates it. Missing row is a spec violation, not a user error.
  const row = await c.env.DB
    .prepare('SELECT records FROM merchants WHERE ens_name = ?1')
    .bind(ensName)
    .first<{ records: string }>()
  if (!row) {
    return c.json({ error: 'merchant_not_bootstrapped', ensName }, 422)
  }
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(row.records)
  } catch {
    return c.json({ error: 'merchant_records_corrupt' }, 500)
  }
  parsed[key] = value

  await c.env.DB
    .prepare(
      `UPDATE merchants SET records = ?1, updated_at = ?2 WHERE ens_name = ?3`,
    )
    .bind(JSON.stringify(parsed), writtenAt, ensName)
    .run()

  return c.json({
    txHash:     null,
    updated:    true,
    recordKey:  key,
    updatedAt:  writtenAt,
  }, 200)
}
