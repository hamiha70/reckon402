import { describe, test, expect, vi } from 'vitest'
import type { Env } from '../../src/env.js'

// ─── Shared fake D1 helpers ──────────────────────────────────────────────────

function makeFakeDb(
  merchants: Array<{ ens_name: string; enabled: number; records: string }> = [],
  agentIndex: Array<{ ens_name: string; chain_id: number; agent_id: number }> = [],
) {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('merchants')) {
                const name = _args[0] as string
                const row = merchants.find(m => m.ens_name === name)
                return (row ?? null) as T | null
              }
              if (sql.includes('agent_id_index')) {
                const name = _args[0] as string
                const row = agentIndex.find(a => a.ens_name === name)
                return (row ?? null) as T | null
              }
              if (sql.includes('_healthz_probe')) {
                return { v: 1 } as T
              }
              return null
            },
          }
        },
      }
    },
  }
}

// ─── dispatch.ts — ENABLE_ERC8004_READS branch ────────────────────────────────
//
// L4a₂: the flag-true branch fetches the static value, then (for pricing
// keys only) tries to resolve an agentId and layer a tier discount. For
// non-pricing keys or when the agent isn't indexed, it returns the
// static value unchanged — which is what this unit test exercises.
// Flag-true integration paths that actually call the ERC-8004 reader
// are covered in gateway/test/integration/erc8004-*.test.ts.

describe('resolveRecord', () => {
  test('flag=true + non-pricing key + known merchant → returns static value unchanged', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')

    const records = JSON.stringify({ 'x402.facilitator': 'https://facilitator.reckon402.com' })
    const db = makeFakeDb([{ ens_name: 'seller.reckon402-test.eth', enabled: 1, records }])

    const env = {
      ENABLE_ERC8004_READS: 'true',
      DB: db,
    } as unknown as Env

    const value = await resolveRecord('seller.reckon402-test.eth', 'x402.facilitator', env)
    expect(value).toBe('https://facilitator.reckon402.com')
  })

  test('returns static value when ENABLE_ERC8004_READS=false', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')

    const records = JSON.stringify({ 'x402.facilitator': 'https://facilitator.reckon402.com' })
    const db = makeFakeDb([{ ens_name: 'seller.reckon402-test.eth', enabled: 1, records }])

    const env = {
      ENABLE_ERC8004_READS: 'false',
      DB: db,
    } as unknown as Env

    const value = await resolveRecord('seller.reckon402-test.eth', 'x402.facilitator', env)
    expect(value).toBe('https://facilitator.reckon402.com')
  })

  test('throws UNKNOWN_NAME for missing merchant', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')
    const { GatewayError } = await import('../../src/lib/errors.js')

    const env = {
      ENABLE_ERC8004_READS: 'false',
      DB: makeFakeDb([]),  // empty
    } as unknown as Env

    let caught: unknown
    try { await resolveRecord('unknown.eth', 'x402.pricing', env) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(GatewayError)
    expect((caught as InstanceType<typeof GatewayError>).code).toBe('UNKNOWN_NAME')
  })

  test('returns empty string for unknown key in existing merchant', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')

    const records = JSON.stringify({ 'x402.facilitator': 'https://facilitator.reckon402.com' })
    const db = makeFakeDb([{ ens_name: 'seller.reckon402-test.eth', enabled: 1, records }])

    const env = {
      ENABLE_ERC8004_READS: 'false',
      DB: db,
    } as unknown as Env

    const value = await resolveRecord('seller.reckon402-test.eth', 'x402.nonexistent', env)
    expect(value).toBe('')
  })
})
