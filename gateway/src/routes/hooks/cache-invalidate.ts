import type { Context } from 'hono'
import type { Env } from '../../env.js'
import { cacheKey, CHAIN_CONFIGS, requireReputationAddress, requireIdentityAddress } from '@reckon402/erc-8004-client'
import { D1Erc8004Cache } from '../../erc8004/index.js'

/**
 * Constant-time comparison to blunt timing-side-channel guessing of
 * the shared token. Node crypto isn't available at CFW runtime; this
 * XOR loop is the stock CFW-compatible substitute.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface InvalidateBody {
  agentId?: unknown
  chainId?: unknown
  keys?: unknown
}

const ALLOWED_KEYS = new Set([
  'reputation.getSummary',
  'reputation.getClients',
  'reputation.getLastIndex',
  'reputation.getResponseCount',
  'reputation.readFeedback',
  'reputation.readAllFeedback',
  'identity.ownerOf',
  'identity.tokenURI',
  'identity.getAgentWallet',
  'identity.getMetadata',
])

function contractFor(chainId: number, key: string): string | null {
  if (key.startsWith('reputation.')) {
    try {
      return requireReputationAddress(chainId)
    } catch {
      return null
    }
  }
  if (key.startsWith('identity.')) {
    try {
      return requireIdentityAddress(chainId)
    } catch {
      return null
    }
  }
  return null
}

export async function cacheInvalidateHandler(c: Context<{ Bindings: Env }>) {
  const authHeader = c.req.header('Authorization') ?? ''
  const expectedToken = c.env.GATEWAY_CACHE_HOOK_TOKEN
  if (!expectedToken) {
    return c.json({ code: 'HOOK_NOT_CONFIGURED' }, 503)
  }
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  if (!presented || !constantTimeEquals(presented, expectedToken)) {
    return c.json({ code: 'UNAUTHORIZED' }, 401)
  }

  let body: InvalidateBody
  try {
    body = (await c.req.json()) as InvalidateBody
  } catch {
    return c.json({ code: 'MALFORMED_BODY' }, 400)
  }

  const chainId = typeof body.chainId === 'number' && Number.isInteger(body.chainId) ? body.chainId : NaN
  const agentIdRaw = body.agentId
  const keys = Array.isArray(body.keys) ? body.keys : null

  if (!Number.isFinite(chainId) || !CHAIN_CONFIGS[chainId]) {
    return c.json({ code: 'UNSUPPORTED_CHAIN', chainId: body.chainId }, 400)
  }
  if (typeof agentIdRaw !== 'number' && typeof agentIdRaw !== 'string') {
    return c.json({ code: 'MALFORMED_AGENT_ID' }, 400)
  }
  let agentId: bigint
  try {
    agentId = BigInt(agentIdRaw as number | string)
    if (agentId < 0n) throw new Error('negative agentId')
  } catch {
    return c.json({ code: 'MALFORMED_AGENT_ID' }, 400)
  }
  if (!keys || keys.length === 0) {
    return c.json({ code: 'EMPTY_KEYS' }, 400)
  }
  for (const k of keys) {
    if (typeof k !== 'string' || !ALLOWED_KEYS.has(k)) {
      return c.json({ code: 'UNSUPPORTED_KEY', key: k }, 400)
    }
  }

  const cache = new D1Erc8004Cache(c.env.DB)
  let deleted = 0
  for (const key of keys as string[]) {
    const contract = contractFor(chainId, key)
    if (!contract) continue
    // Cache-key prefix shared with @reckon402/erc-8004-client's cacheKey()
    // format: "erc8004:{chainId}:{contract.toLowerCase()}:{fn}:{argsDigest}"
    // Match all argsDigest variants by wildcard on the trailing portion.
    const prefix = cacheKey({ chainId, contract, fn: key, args: '' })
    // Over-invalidation is acceptable for the hackathon scope; strict
    // agent-scoped invalidation requires knowing the argsDigest → agentId
    // map, which the library doesn't persist.
    const n = await cache.deletePattern(prefix)
    if (n > 0) deleted += n
  }

  return c.json({ deleted, agentId: agentId.toString(), chainId, keys }, 200)
}
