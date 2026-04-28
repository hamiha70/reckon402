import { describe, test, expect } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../../src/env.js'
import { cacheInvalidateHandler } from '../../src/routes/hooks/cache-invalidate.js'

interface D1RunResult {
  meta: { changes: number }
}

function makeFakeDb(initialRows: Array<{ cache_key: string; value_json: string; expires_at: number }>) {
  const rows = [...initialRows]
  const log: Array<{ sql: string; args: unknown[]; changes: number }> = []
  const db = {
    prepare(sql: string) {
      const boundArgs: unknown[] = []
      const obj = {
        bind(...args: unknown[]) {
          boundArgs.push(...args)
          return obj
        },
        async first() {
          return null
        },
        async run(): Promise<D1RunResult> {
          if (sql.includes('DELETE FROM erc8004_cache WHERE cache_key LIKE')) {
            const pattern = boundArgs[0] as string
            const prefix = pattern.replace(/%$/, '')
            const before = rows.length
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i]!.cache_key.startsWith(prefix)) rows.splice(i, 1)
            }
            const changes = before - rows.length
            log.push({ sql, args: boundArgs, changes })
            return { meta: { changes } }
          }
          const changes = 0
          log.push({ sql, args: boundArgs, changes })
          return { meta: { changes } }
        },
      }
      return obj
    },
    _rows: () => rows,
    _log: () => log,
  }
  return db
}

function makeEnv(db: ReturnType<typeof makeFakeDb>, token = 'secret-token'): Env {
  return {
    DB: db as unknown as Env['DB'],
    RESOLVER_CONTRACT_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000001',
    ENABLE_ERC8004_READS: 'true',
    STEALTH_ENABLED: 'false',
    RECKON402_RESOLVER_SIGNER_PK: '0x' + 'ab'.repeat(32),
    ETH_SEPOLIA_RPC_PRIMARY: 'https://fake.example.com',
    BASE_SEPOLIA_RPC: 'https://fake-base-sepolia.example.com',
    BASE_MAINNET_RPC: '',
    CACHE_TTL_REPUTATION_S: '300',
    GATEWAY_CACHE_HOOK_TOKEN: token,
  }
}

async function post(env: Env, body: unknown, token?: string) {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/hooks/cache-invalidate', cacheInvalidateHandler)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`
  const req = new Request('http://localhost/hooks/cache-invalidate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return app.fetch(req, env)
}

describe('POST /hooks/cache-invalidate', () => {
  const REP_ADDR = '0x8004b663056a597dffe9eccc1965a193b7388713'
  const baseRow = {
    value_json: 'cached',
    expires_at: Date.now() + 60_000,
  }

  test('401 when Authorization header missing', async () => {
    const db = makeFakeDb([])
    const res = await post(makeEnv(db), { agentId: 1, chainId: 84532, keys: ['reputation.getSummary'] })
    expect(res.status).toBe(401)
  })

  test('401 when token is wrong', async () => {
    const db = makeFakeDb([])
    const res = await post(makeEnv(db), { agentId: 1, chainId: 84532, keys: ['reputation.getSummary'] }, 'nope')
    expect(res.status).toBe(401)
  })

  test('200 with deleted count when pattern matches', async () => {
    const db = makeFakeDb([
      { cache_key: `erc8004:84532:${REP_ADDR}:reputation.getSummary:abc123`, ...baseRow },
      { cache_key: `erc8004:84532:${REP_ADDR}:reputation.getSummary:def456`, ...baseRow },
      { cache_key: `erc8004:84532:${REP_ADDR}:reputation.getClients:xyz789`, ...baseRow },
    ])
    const env = makeEnv(db)
    const res = await post(env, { agentId: 1, chainId: 84532, keys: ['reputation.getSummary'] }, 'secret-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number; keys: string[] }
    expect(body.deleted).toBe(2)
    expect(body.keys).toEqual(['reputation.getSummary'])
    // The getClients row is untouched
    expect(db._rows()).toHaveLength(1)
  })

  test('200 with deleted=0 when no pattern matches', async () => {
    const db = makeFakeDb([
      { cache_key: `erc8004:84532:${REP_ADDR}:reputation.getClients:xyz789`, ...baseRow },
    ])
    const res = await post(makeEnv(db), { agentId: 1, chainId: 84532, keys: ['reputation.getSummary'] }, 'secret-token')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(0)
  })

  test('400 MALFORMED_AGENT_ID when agentId is garbage', async () => {
    const db = makeFakeDb([])
    const res = await post(makeEnv(db), { agentId: {}, chainId: 84532, keys: ['reputation.getSummary'] }, 'secret-token')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('MALFORMED_AGENT_ID')
  })

  test('400 UNSUPPORTED_CHAIN when chainId is not pinned', async () => {
    const db = makeFakeDb([])
    const res = await post(makeEnv(db), { agentId: 1, chainId: 99999, keys: ['reputation.getSummary'] }, 'secret-token')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('UNSUPPORTED_CHAIN')
  })

  test('400 UNSUPPORTED_KEY when keys contain an unknown function', async () => {
    const db = makeFakeDb([])
    const res = await post(
      makeEnv(db),
      { agentId: 1, chainId: 84532, keys: ['not.a.key'] },
      'secret-token',
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('UNSUPPORTED_KEY')
  })

  test('400 EMPTY_KEYS when keys array is empty', async () => {
    const db = makeFakeDb([])
    const res = await post(makeEnv(db), { agentId: 1, chainId: 84532, keys: [] }, 'secret-token')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('EMPTY_KEYS')
  })

  test('503 HOOK_NOT_CONFIGURED when GATEWAY_CACHE_HOOK_TOKEN is empty', async () => {
    const db = makeFakeDb([])
    const env = makeEnv(db, '')
    const res = await post(env, { agentId: 1, chainId: 84532, keys: ['reputation.getSummary'] }, 'secret-token')
    expect(res.status).toBe(503)
  })
})
