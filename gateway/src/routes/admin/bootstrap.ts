import type { Context } from 'hono'
import type { Env } from '../../env.js'
import { recoverSignedWriteSigner, sameAddress } from './auth.js'

interface BootstrapBody {
  ensName?:   unknown
  records?:   unknown  // {key: value} map
  nonce?:     unknown
  signature?: unknown  // signs keccak256(encode(chainId, ensName, 'bootstrap', JSON.stringify(sortedRecords), nonce))
}

interface GatewaySeedBody {
  ensName?:   unknown
  chainId?:   unknown
  agentId?:   unknown
  records?:   unknown
  nonce?:     unknown
  signature?: unknown
}

const MAX_RECORDS = 64
const MAX_VALUE_BYTES = 2048

/**
 * Canonicalize records → deterministic JSON string for digest.
 * Keys sorted alphabetically; values are strings.
 */
function canonicalRecordsString(records: Record<string, string>): string {
  const keys = Object.keys(records).sort()
  const pairs: Array<[string, string]> = keys.map(k => [k, records[k]!])
  // Build object in sorted order so JSON.stringify is deterministic.
  const obj: Record<string, string> = {}
  for (const [k, v] of pairs) obj[k] = v
  return JSON.stringify(obj)
}

/**
 * POST /admin/bootstrap
 *
 * Reckon402-signed batch seed. Creates or updates the merchants row for
 * `ensName` with the provided records JSON. Requires a signature from
 * RECKON402_ONBOARDING_EOA over the canonicalized payload.
 *
 * Unlike /admin/records, this endpoint does not consult the ACL — any key
 * can be set. It is the single ingestion point at onboarding time, before
 * ENS subnode ownership transfer to the SellingAgent. Once ownership has
 * transferred away from RECKON402_ONBOARDING_EOA, the ACL kicks in on
 * subsequent /admin/records calls for merchant-owned keys; Reckon402 can
 * still call /admin/bootstrap but its effects on merchant keys would be
 * redundant (the SellingAgent can overwrite via /admin/records).
 *
 * We do NOT block /admin/bootstrap post-transfer — the SellingAgent may
 * explicitly ask Reckon402 to re-seed. That is a permissioned choice by
 * the ENS owner; if they don't want it, they can rotate ownership.
 */
export async function adminBootstrapHandler(c: Context<{ Bindings: Env }>) {
  let body: BootstrapBody
  try {
    body = (await c.req.json()) as BootstrapBody
  } catch {
    return c.json({ error: 'malformed_json' }, 400)
  }

  const ensName   = typeof body.ensName   === 'string' ? body.ensName   : null
  const nonce     = typeof body.nonce     === 'string' ? body.nonce     : null
  const signature = typeof body.signature === 'string' ? body.signature : null
  const records   = body.records && typeof body.records === 'object' && !Array.isArray(body.records)
    ? (body.records as Record<string, unknown>)
    : null

  if (!ensName || !nonce || !signature || !records) {
    return c.json({ error: 'malformed_body' }, 422)
  }
  if (ensName.length === 0 || ensName.length > 253 || !ensName.includes('.')) {
    return c.json({ error: 'malformed_ens_name' }, 422)
  }
  const entries = Object.entries(records)
  if (entries.length === 0 || entries.length > MAX_RECORDS) {
    return c.json({ error: 'malformed_records' }, 422)
  }
  const normalized: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || k.length === 0) {
      return c.json({ error: 'malformed_records' }, 422)
    }
    if (typeof v !== 'string' || v.length > MAX_VALUE_BYTES) {
      return c.json({ error: 'malformed_records' }, 422)
    }
    normalized[k] = v
  }

  const reckon402Eoa = c.env.RECKON402_ONBOARDING_EOA
  if (!reckon402Eoa) {
    return c.json({ error: 'onboarding_eoa_not_configured' }, 503)
  }

  const canon = canonicalRecordsString(normalized)
  const signer = await recoverSignedWriteSigner({
    ensName,
    key:       'bootstrap',
    value:     canon,
    nonce:     nonce as `0x${string}`,
    signature: signature as `0x${string}`,
  })
  if (!signer) {
    return c.json({ error: 'invalid_signature' }, 401)
  }
  if (!sameAddress(signer, reckon402Eoa)) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const writtenAt = Date.now()

  // Replay guard using the bootstrap key sentinel.
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO record_updates
           (ens_name, record_key, record_value, nonce, signer_addr, written_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(ensName, '_bootstrap', canon, nonce, signer, writtenAt)
      .run()
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.toLowerCase().includes('unique')) {
      return c.json({ error: 'replay', nonce }, 409)
    }
    return c.json({ error: 'db_error' }, 500)
  }

  // Upsert merchants row with the full records map.
  const existing = await c.env.DB
    .prepare('SELECT records FROM merchants WHERE ens_name = ?1')
    .bind(ensName)
    .first<{ records: string }>()

  let merged: Record<string, string> = {}
  if (existing) {
    try { merged = JSON.parse(existing.records) } catch { merged = {} }
  }
  for (const [k, v] of Object.entries(normalized)) merged[k] = v

  if (existing) {
    await c.env.DB
      .prepare(`UPDATE merchants SET records = ?1, updated_at = ?2 WHERE ens_name = ?3`)
      .bind(JSON.stringify(merged), writtenAt, ensName)
      .run()
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO merchants (ens_name, enabled, records, created_at, updated_at)
         VALUES (?1, 1, ?2, ?3, ?3)`,
      )
      .bind(ensName, JSON.stringify(merged), writtenAt)
      .run()
  }

  return c.json({
    updated:   true,
    ensName,
    keys:      Object.keys(normalized),
    updatedAt: writtenAt,
  }, 200)
}

/**
 * POST /admin/bootstrap/gateway-seed
 *
 * Reckon402-signed combined seed: writes the agent_id_index row plus the
 * merchants.records JSON in one call. This is the seed-gateway step of the
 * onboarding script (spec 08B §3.6 + §4.3).
 *
 * Digest canonicalization: value = `${chainId}:${agentId}:${canonRecords}`.
 */
export async function adminBootstrapGatewaySeedHandler(c: Context<{ Bindings: Env }>) {
  let body: GatewaySeedBody
  try {
    body = (await c.req.json()) as GatewaySeedBody
  } catch {
    return c.json({ error: 'malformed_json' }, 400)
  }

  const ensName   = typeof body.ensName   === 'string' ? body.ensName   : null
  const nonce     = typeof body.nonce     === 'string' ? body.nonce     : null
  const signature = typeof body.signature === 'string' ? body.signature : null
  const records   = body.records && typeof body.records === 'object' && !Array.isArray(body.records)
    ? (body.records as Record<string, unknown>)
    : null

  let chainId: number | null = null
  if (typeof body.chainId === 'number' && Number.isInteger(body.chainId)) chainId = body.chainId
  else if (typeof body.chainId === 'string') {
    const parsed = Number(body.chainId)
    if (Number.isInteger(parsed)) chainId = parsed
  }

  let agentId: bigint | null = null
  if (typeof body.agentId === 'number' || typeof body.agentId === 'string') {
    try {
      agentId = BigInt(body.agentId as number | string)
      if (agentId <= 0n) agentId = null
    } catch { agentId = null }
  }

  if (!ensName || !nonce || !signature || !records || chainId === null || agentId === null) {
    return c.json({ error: 'malformed_body' }, 422)
  }
  if (!ensName.includes('.') || ensName.length > 253) {
    return c.json({ error: 'malformed_ens_name' }, 422)
  }
  const entries = Object.entries(records)
  if (entries.length === 0 || entries.length > MAX_RECORDS) {
    return c.json({ error: 'malformed_records' }, 422)
  }
  const normalized: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || v.length > MAX_VALUE_BYTES) {
      return c.json({ error: 'malformed_records' }, 422)
    }
    normalized[k] = v
  }

  const reckon402Eoa = c.env.RECKON402_ONBOARDING_EOA
  if (!reckon402Eoa) {
    return c.json({ error: 'onboarding_eoa_not_configured' }, 503)
  }

  const canon = canonicalRecordsString(normalized)
  const digestValue = `${chainId}:${agentId.toString()}:${canon}`
  const signer = await recoverSignedWriteSigner({
    ensName,
    key:       'gateway-seed',
    value:     digestValue,
    nonce:     nonce as `0x${string}`,
    signature: signature as `0x${string}`,
  })
  if (!signer) {
    return c.json({ error: 'invalid_signature' }, 401)
  }
  if (!sameAddress(signer, reckon402Eoa)) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const writtenAt = Date.now()

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO record_updates
           (ens_name, record_key, record_value, nonce, signer_addr, written_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(ensName, '_gateway_seed', digestValue, nonce, signer, writtenAt)
      .run()
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.toLowerCase().includes('unique')) {
      return c.json({ error: 'replay', nonce }, 409)
    }
    return c.json({ error: 'db_error' }, 500)
  }

  // Upsert agent_id_index
  await c.env.DB
    .prepare(
      `INSERT INTO agent_id_index (ens_name, chain_id, agent_id, created_at)
         VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(ens_name) DO UPDATE SET
         chain_id   = excluded.chain_id,
         agent_id   = excluded.agent_id`,
    )
    .bind(ensName, chainId, Number(agentId), writtenAt)
    .run()

  // Upsert merchants row
  const existing = await c.env.DB
    .prepare('SELECT records FROM merchants WHERE ens_name = ?1')
    .bind(ensName)
    .first<{ records: string }>()

  let merged: Record<string, string> = {}
  if (existing) {
    try { merged = JSON.parse(existing.records) } catch { merged = {} }
  }
  for (const [k, v] of Object.entries(normalized)) merged[k] = v

  if (existing) {
    await c.env.DB
      .prepare(`UPDATE merchants SET records = ?1, updated_at = ?2 WHERE ens_name = ?3`)
      .bind(JSON.stringify(merged), writtenAt, ensName)
      .run()
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO merchants (ens_name, enabled, records, created_at, updated_at)
         VALUES (?1, 1, ?2, ?3, ?3)`,
      )
      .bind(ensName, JSON.stringify(merged), writtenAt)
      .run()
  }

  return c.json({
    seeded:    true,
    ensName,
    chainId,
    agentId:   agentId.toString(),
    updatedAt: writtenAt,
  }, 200)
}

// Exposed for vitest: canonicalization uses the same function as sig building
// on the client side (tools/onboard/steps/set-ens-records.ts).
export { canonicalRecordsString }
