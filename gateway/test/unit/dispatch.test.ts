import { describe, test, expect, vi } from 'vitest'
import type { Env } from '../../src/env.js'

// ─── Shared fake D1 helpers ──────────────────────────────────────────────────

function makeFakeDb(merchants: Array<{ ens_name: string; enabled: number; records: string }> = []) {
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

// ─── dispatch.ts — NOT_IMPLEMENTED branch ────────────────────────────────────

describe('resolveRecord', () => {
  test('throws NOT_IMPLEMENTED when ENABLE_ERC8004_READS=true', async () => {
    const { resolveRecord } = await import('../../src/resolution/dispatch.js')

    const env = {
      ENABLE_ERC8004_READS: 'true',
      DB: makeFakeDb(),
    } as unknown as Env

    await expect(resolveRecord('seller.reckon402-test.eth', 'x402.pricing', env)).rejects.toThrow(
      'NOT_IMPLEMENTED',
    )
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
