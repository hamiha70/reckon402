import { describe, test, expect } from 'vitest'
import { ProgressStore, generateOnboardId } from '../src/progress-store.js'
import type { OnboardStep, OnboardResult } from '@reckon402/onboard'

// In-memory D1 stub that supports the exact SQL shapes used by ProgressStore.
interface Row {
  onboard_id:  string
  ens_name:    string
  seller_eoa:  string
  status:      string
  steps_json:  string
  result_json: string | null
  started_at:  number
  updated_at:  number
}

function makeDb() {
  const rows: Map<string, Row> = new Map()
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('SELECT 1')) return { '1': 1 } as T
              if (sql.includes('SELECT steps_json')) {
                const id = args[0] as string
                const row = rows.get(id)
                return (row ? { steps_json: row.steps_json } : null) as T | null
              }
              if (sql.includes('SELECT onboard_id')) {
                const id = args[0] as string
                return (rows.get(id) ?? null) as T | null
              }
              return null
            },
            async run() {
              if (sql.startsWith('INSERT INTO onboard_progress')) {
                const [onboard_id, ens_name, seller_eoa, started_at] = args as [string, string, string, number]
                rows.set(onboard_id, {
                  onboard_id, ens_name, seller_eoa,
                  status: 'running', steps_json: '[]', result_json: null,
                  started_at, updated_at: started_at,
                })
                return { success: true }
              }
              if (sql.includes("SET steps_json")) {
                const [steps_json, updated_at, onboard_id] = args as [string, number, string]
                const row = rows.get(onboard_id)
                if (row) { row.steps_json = steps_json; row.updated_at = updated_at }
                return { success: true }
              }
              if (sql.includes("status = 'succeeded'")) {
                const [result_json, updated_at, onboard_id] = args as [string, number, string]
                const row = rows.get(onboard_id)
                if (row) { row.status = 'succeeded'; row.result_json = result_json; row.updated_at = updated_at }
                return { success: true }
              }
              if (sql.includes("status = 'failed'")) {
                const [result_json, updated_at, onboard_id] = args as [string, number, string]
                const row = rows.get(onboard_id)
                if (row) { row.status = 'failed'; row.result_json = result_json; row.updated_at = updated_at }
                return { success: true }
              }
              return { success: true }
            },
          }
        },
      }
    },
  }
  return { db: db as any, rows }
}

describe('generateOnboardId', () => {
  test('produces 32-char hex strings', () => {
    const id = generateOnboardId()
    expect(id).toMatch(/^[a-f0-9]{32}$/)
  })
  test('collisions are vanishingly unlikely (batch of 100)', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateOnboardId()))
    expect(ids.size).toBe(100)
  })
})

describe('ProgressStore', () => {
  test('create → recordStep → complete round-trip', async () => {
    const { db, rows } = makeDb()
    const store = new ProgressStore(db)
    const id = 'a'.repeat(32)
    const SELLER = '0xD53F000000000000000000000000000000000001' as `0x${string}`

    await store.create(id, 'seller9.reckon402-test.eth', SELLER)
    expect(rows.get(id)?.status).toBe('running')

    const step1: OnboardStep = { id: 1, label: 'Mint', startedAt: 100 }
    await store.recordStep(id, step1)
    const step1done: OnboardStep = { ...step1, completedAt: 200, txHash: '0xabc' }
    await store.recordStep(id, step1done)

    const progress = await store.get(id)
    expect(progress).not.toBeNull()
    expect(progress!.steps).toHaveLength(1)
    expect(progress!.steps[0]).toMatchObject({ id: 1, completedAt: 200, txHash: '0xabc' })

    const result = {
      ensName: 'seller9.reckon402-test.eth',
      sellerEoa: SELLER,
      agentId: 3n,
      splitter: '0xCAFE000000000000000000000000000000000001',
      splitterDeployTx: '0xdeploy',
      subnameRegisterTx: '0xens',
      subnameOwnerTransferTx: '0xowner',
      agentRegisterTx: '0xagent',
      agentTransferTx: '0xtransfer',
      steps: [step1done],
    } as OnboardResult
    await store.complete(id, result)

    const final = await store.get(id)
    expect(final!.status).toBe('succeeded')
    expect(final!.result).toMatchObject({ agentId: '3' })  // bigint → string
  })

  test('fail records error and transitions status', async () => {
    const { db } = makeDb()
    const store = new ProgressStore(db)
    const id = 'b'.repeat(32)
    await store.create(id, 'seller9.reckon402-test.eth', '0xD53F000000000000000000000000000000000001')
    await store.fail(id, 'rpc down')
    const progress = await store.get(id)
    expect(progress!.status).toBe('failed')
    expect(progress!.result).toMatchObject({ error: 'rpc down' })
  })

  test('recordStep updates existing step by id', async () => {
    const { db } = makeDb()
    const store = new ProgressStore(db)
    const id = 'c'.repeat(32)
    await store.create(id, 'x.eth', '0xD53F000000000000000000000000000000000001')
    await store.recordStep(id, { id: 1, label: 'Mint', startedAt: 100 })
    await store.recordStep(id, { id: 1, label: 'Mint', startedAt: 100, completedAt: 200 })
    const p = await store.get(id)
    expect(p!.steps).toHaveLength(1)
    expect(p!.steps[0]!.completedAt).toBe(200)
  })

  test('get(nonExistentId) returns null', async () => {
    const { db } = makeDb()
    const store = new ProgressStore(db)
    expect(await store.get('z'.repeat(32))).toBeNull()
  })
})
