import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/env.js'
import type { Hex } from 'viem'

// Mock ERC-8004 client before any imports that touch reader.ts
const rpcCalls: Array<{ fn: string; agentId: bigint }> = []
const summaryResponses: Map<string, { count: bigint; summaryValue: bigint; decimals: number }> = new Map()

vi.mock('@reckon402/erc-8004-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reckon402/erc-8004-client')>()
  return {
    ...actual,
    reputation: {
      ...actual.reputation,
      async getSummaryForAllClients(args: { agentId: bigint }) {
        rpcCalls.push({ fn: 'getSummaryForAllClients', agentId: args.agentId })
        return summaryResponses.get(args.agentId.toString()) ?? { count: 0n, summaryValue: 0n, decimals: 0 }
      },
    },
  }
})

// ─── Fake D1 ────────────────────────────────────────────────────────────────

function makeFakeDb(
  merchants: Array<{ ens_name: string; enabled: number; records: Record<string, string> }>,
  agentIndex: Array<{ ens_name: string; chain_id: number; agent_id: number }> = [],
) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const bound = args
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('agent_id_index')) {
                const name = bound[0] as string
                const row = agentIndex.find(a => a.ens_name === name)
                return (row ?? null) as T | null
              }
              if (sql.includes('merchants')) {
                const name = bound[0] as string
                const row = merchants.find(m => m.ens_name === name)
                if (!row) return null
                return {
                  ens_name: row.ens_name,
                  enabled:  row.enabled,
                  records:  JSON.stringify(row.records),
                } as T
              }
              return null
            },
          }
        },
      }
    },
  }
}

function makeEnv(
  merchants: Array<{ ens_name: string; enabled: number; records: Record<string, string> }>,
  agentIndex: Array<{ ens_name: string; chain_id: number; agent_id: number }> = [],
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: makeFakeDb(merchants, agentIndex) as unknown as Env['DB'],
    RESOLVER_CONTRACT_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000001',
    ENABLE_ERC8004_READS: 'true',
    STEALTH_ENABLED: 'false',
    RECKON402_RESOLVER_SIGNER_PK: ('0x' + 'ab'.repeat(32)) as Hex,
    ETH_SEPOLIA_RPC_PRIMARY: 'https://fake.example.com',
    BASE_SEPOLIA_RPC: 'https://fake-base-sepolia.example.com',
    BASE_MAINNET_RPC: '',
    CACHE_TTL_REPUTATION_S: '300',
    GATEWAY_CACHE_HOOK_TOKEN: 'test-token',
    RECKON402_ONBOARDING_EOA: '0x0000000000000000000000000000000000000001',
    ...overrides,
  }
}

async function makeApp(env: Env) {
  const { recordsFlatHandler, recordsFlatOptions } = await import('../src/routes/records-flat.js')
  const app = new Hono<{ Bindings: Env }>()
  app.options('/records/:ensName', recordsFlatOptions)
  app.get('/records/:ensName', recordsFlatHandler)
  return {
    async get(path: string): Promise<Response> {
      const req = new Request('http://localhost' + path)
      return app.fetch(req, env)
    },
  }
}

const BASE_MERCHANT = {
  ens_name: 'seller.reckon402-test.eth',
  enabled: 1,
  records: {
    'x402.amount':    '100000',
    'x402.pricing':   JSON.stringify({ discount_bps: 0 }),
    'x402.endpoint':  'https://agent.example.com/api',
    'x402.splitter':  '0x1234000000000000000000000000000000000000',
  },
}

beforeEach(() => {
  rpcCalls.length = 0
  summaryResponses.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /records/:ensName', () => {
  test('happy path backend=static: returns raw records unchanged', async () => {
    const env = makeEnv([BASE_MERCHANT])
    const app = await makeApp(env)

    const res = await app.get('/records/seller.reckon402-test.eth?flat=true&backend=static')
    expect(res.status).toBe(200)

    const body = await res.json() as { records: Record<string, string> }
    expect(body.records).toMatchObject({
      'x402.amount':   '100000',
      'x402.endpoint': 'https://agent.example.com/api',
    })
    // Static path must NOT touch the ERC-8004 reader
    expect(rpcCalls).toHaveLength(0)
  })

  test('happy path backend=erc8004: returns discounted x402.amount', async () => {
    // count=3 → 1000 bps → 100000 * 0.9 = 90000
    summaryResponses.set('42', { count: 3n, summaryValue: 0n, decimals: 0 })

    const env = makeEnv(
      [BASE_MERCHANT],
      [{ ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 42 }],
    )
    const app = await makeApp(env)

    const res = await app.get('/records/seller.reckon402-test.eth?flat=true&backend=erc8004')
    expect(res.status).toBe(200)

    const body = await res.json() as { records: Record<string, string> }
    // Discount applied: 100000 * (10000 - 1000) / 10000 = 90000
    expect(body.records['x402.amount']).toBe('90000')
    // Non-pricing keys must remain unchanged
    expect(body.records['x402.endpoint']).toBe('https://agent.example.com/api')
    // ERC-8004 reader was called exactly once, with the correct agentId
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].agentId).toBe(42n)
  })

  test('unknown ENS name: 404', async () => {
    const env = makeEnv([BASE_MERCHANT])
    const app = await makeApp(env)

    const res = await app.get('/records/unknown.reckon402-test.eth?flat=true&backend=static')
    expect(res.status).toBe(404)

    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('UNKNOWN_NAME')
  })

  test('malformed ensName (non-ASCII): 422', async () => {
    const env = makeEnv([BASE_MERCHANT])
    const app = await makeApp(env)

    // Non-ASCII byte in the name
    const res = await app.get('/records/s%C3%A9ller.eth?flat=true')
    expect(res.status).toBe(422)

    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('MALFORMED_NAME')
  })
})
