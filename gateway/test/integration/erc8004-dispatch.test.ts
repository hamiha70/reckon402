import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/env.js'

/**
 * L4a₂ integration tests for the ERC-8004 read path.
 *
 * We mock @reckon402/erc-8004-client's reputation module at module
 * level (same pattern as workers/facilitator/test/settle.test.ts'
 * viem mock), so these tests exercise dispatch.ts → reader.ts →
 * pricing.ts end-to-end without a live RPC.
 *
 * Fake D1 supports BOTH merchants and agent_id_index rows (matches
 * the production schema in migrations/0002_erc8004_cache.sql).
 */

// Mock module-level; must come before any import that touches reader.ts.
const rpcCalls: Array<{ fn: string; args: unknown[] }> = []
const summaryResponses: Map<string, { count: bigint; summaryValue: bigint; decimals: number }> = new Map()

vi.mock('@reckon402/erc-8004-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reckon402/erc-8004-client')>()
  return {
    ...actual,
    reputation: {
      ...actual.reputation,
      async getSummaryForAllClients(args: { agentId: bigint }) {
        rpcCalls.push({ fn: 'getSummaryForAllClients', args: [args.agentId] })
        return summaryResponses.get(args.agentId.toString()) ?? { count: 0n, summaryValue: 0n, decimals: 0 }
      },
    },
  }
})

function makeFakeDb(
  merchants: Array<{ ens_name: string; enabled: number; records: string }>,
  agentIndex: Array<{ ens_name: string; chain_id: number; agent_id: number }>,
) {
  return {
    prepare(sql: string) {
      return {
        bind(...boundArgs: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('agent_id_index')) {
                const name = boundArgs[0] as string
                const row = agentIndex.find((a) => a.ens_name === name)
                return (row ?? null) as T | null
              }
              if (sql.includes('merchants')) {
                const name = boundArgs[0] as string
                const row = merchants.find((m) => m.ens_name === name)
                return (row ?? null) as T | null
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
  merchants: Array<{ ens_name: string; enabled: number; records: string }>,
  agentIndex: Array<{ ens_name: string; chain_id: number; agent_id: number }>,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: makeFakeDb(merchants, agentIndex) as unknown as Env['DB'],
    RESOLVER_CONTRACT_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000001',
    ENABLE_ERC8004_READS: 'true',
    STEALTH_ENABLED: 'false',
    RECKON402_RESOLVER_SIGNER_PK: '0x' + 'ab'.repeat(32),
    ETH_SEPOLIA_RPC_PRIMARY: 'https://fake.example.com',
    BASE_SEPOLIA_RPC: 'https://fake-base-sepolia.example.com',
    BASE_MAINNET_RPC: '',
    CACHE_TTL_REPUTATION_S: '300',
    GATEWAY_CACHE_HOOK_TOKEN: 'test-token',
    ...overrides,
  }
}

const MERCHANTS_BASE = [
  {
    ens_name: 'seller.reckon402-test.eth',
    enabled: 1,
    records: JSON.stringify({
      'x402.facilitator': 'https://facilitator.reckon402.com',
      'x402.splitter':    '0x0ad507c6973eba86313794329ad9b12fbf24acd0',
      'x402.amount':      '100000',
      'x402.pricing':     JSON.stringify({ discount_bps: 0 }),
    }),
  },
]

beforeEach(() => {
  rpcCalls.length = 0
  summaryResponses.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('dispatch flag=false — regression guard (byte-equal to L4a₁)', () => {
  test('x402.facilitator returns the canned URL unchanged', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [], { ENABLE_ERC8004_READS: 'false' })
    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.facilitator', env)
    expect(v).toBe('https://facilitator.reckon402.com')
    expect(rpcCalls).toHaveLength(0)
  })

  test('x402.amount returns the base integer unchanged', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [], { ENABLE_ERC8004_READS: 'false' })
    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    expect(v).toBe('100000')
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('dispatch flag=true — ERC-8004 path', () => {
  test('unknown-agent graceful fallback: x402.amount returns base value (no RPC)', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, []) // no agent_id_index entry

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    expect(v).toBe('100000')
    expect(rpcCalls).toHaveLength(0)
  })

  test('happy path count=0: x402.amount returns base value (0 bps discount)', async () => {
    summaryResponses.set('1', { count: 0n, summaryValue: 0n, decimals: 0 })
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    expect(v).toBe('100000')
    expect(rpcCalls).toHaveLength(1)
  })

  test('pricing-tier count=1 → 500 bps discount applied to x402.amount', async () => {
    summaryResponses.set('1', { count: 1n, summaryValue: 95n, decimals: 2 })
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    // 100000 * (10000 - 500) / 10000 = 95000
    expect(v).toBe('95000')
  })

  test('pricing-tier count=3 → 1000 bps discount on x402.amount', async () => {
    summaryResponses.set('1', { count: 3n, summaryValue: 270n, decimals: 2 })
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    expect(v).toBe('90000') // 100000 * 0.9
  })

  test('pricing-tier count=10 → 1500 bps discount on x402.amount', async () => {
    summaryResponses.set('1', { count: 10n, summaryValue: 900n, decimals: 2 })
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.amount', env)
    expect(v).toBe('85000') // 100000 * 0.85
  })

  test('x402.pricing key: returns JSON with discount_bps layered on', async () => {
    summaryResponses.set('1', { count: 1n, summaryValue: 0n, decimals: 0 })
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.pricing', env)
    const parsed = JSON.parse(v)
    expect(parsed.discount_bps).toBe(500)
  })

  test('non-pricing key is returned unchanged (no RPC call)', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const env = makeEnv(MERCHANTS_BASE, [
      { ens_name: 'seller.reckon402-test.eth', chain_id: 84532, agent_id: 1 },
    ])

    const v = await resolveRecord('seller.reckon402-test.eth', 'x402.facilitator', env)
    expect(v).toBe('https://facilitator.reckon402.com')
    // dispatch short-circuits before calling the reader for non-pricing keys
    expect(rpcCalls).toHaveLength(0)
  })
})
