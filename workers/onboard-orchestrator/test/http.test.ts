import { describe, test, expect, vi } from 'vitest'
import { getAddress } from 'viem'
import type { Env } from '../src/env.js'

// Mock @reckon402/onboard at module level so the HTTP handler doesn't try to
// make real RPC calls. We capture the runOnboard invocation args (feedback
// rule — assert args, not just "was called").
const runOnboardMock = vi.fn(async (_env: unknown, args: any) => {
  // Simulate a step emission for progress-store round-trip.
  if (args.progressSink) {
    await args.progressSink({ id: 1, label: 'Mint', startedAt: 100 })
    await args.progressSink({ id: 1, label: 'Mint', startedAt: 100, completedAt: 200, txHash: '0xabc' })
  }
  return {
    ensName: args.name,
    sellerEoa: args.sellerEoa,
    agentId: 3n,
    splitter: getAddress('0xcafe000000000000000000000000000000000001'),
    splitterDeployTx: '0xdeploy',
    escrow: args.enableL4dEscrow
      ? getAddress('0xea8b000000000000000000000000000000000001')
      : null,
    escrowDeployTx: args.enableL4dEscrow ? '0xescrow' : null,
    subnameRegisterTx: '0xens',
    subnameOwnerTransferTx: '0xowner',
    agentRegisterTx: '0xagent',
    agentTransferTx: '0xtransfer',
    steps: [],
  }
})

vi.mock('@reckon402/onboard', () => ({ runOnboard: runOnboardMock }))

function makeFakeDb() {
  const rows = new Map<string, any>()
  const db: any = {
    prepare(sql: string) {
      // Support .prepare(sql).first() (no .bind()) for healthz probe.
      if (sql.includes('SELECT 1')) {
        return { async first() { return { '1': 1 } } }
      }
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT steps_json')) {
                const id = args[0] as string
                const row = rows.get(id)
                return row ? { steps_json: row.steps_json } : null
              }
              if (sql.includes('SELECT onboard_id')) {
                const id = args[0] as string
                return rows.get(id) ?? null
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
              if (sql.includes('SET steps_json')) {
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
  return { db: db as Env['DB'], rows }
}

function makeEnv(db: Env['DB']): Env {
  return {
    DB: db,
    SPLITTER_FACTORY_ADDRESS: getAddress('0xf000000000000000000000000000000000000001'),
    RECKON402_ONBOARDING_EOA: getAddress('0xaaaa000000000000000000000000000000000001'),
    GATEWAY_BASE_URL: 'https://gateway.test',
    FACILITATOR_BASE_URL: 'https://facilitator.test',
    CHAIN_ID_BASE_SEPOLIA: '84532',
    ETH_SEPOLIA_RPC_PRIMARY: 'https://eth-sepolia.test',
    BASE_SEPOLIA_RPC_PRIMARY: 'https://base-sepolia.test',
    ENS_FUNDER_PK: '0x' + '11'.repeat(32),
    RECKON402_DEPLOYER_PK: '0x' + '22'.repeat(32),
    RECKON402_ONBOARDING_PK: '0x' + '33'.repeat(32),
  }
}

describe('POST /onboard', () => {
  test('accepts valid payload, returns 202 {onboardId, ensName}, invokes runOnboard with exact args', async () => {
    runOnboardMock.mockClear()
    const { default: worker } = await import('../src/index.js')
    const { db, rows } = makeFakeDb()
    const env = makeEnv(db)

    const SELLER = getAddress('0xd53f000000000000000000000000000000000001')
    const payload = {
      name: 'seller9.reckon402-test.eth',
      sellerEoa: SELLER,
      endpoint: 'https://agent.reckon402.com/research',
      amount: '100000',
    }

    const waitPromises: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => { waitPromises.push(p) } } as ExecutionContext

    const res = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env, ctx,
    )
    expect(res.status).toBe(202)
    const body = await res.json() as { onboardId: string; ensName: string }
    expect(body.onboardId).toMatch(/^[a-f0-9]{32}$/)
    expect(body.ensName).toBe('seller9.reckon402-test.eth')

    // Row was inserted in 'running' state — checked immediately, before we
    // await the background work. The response already returned so the handler
    // is done, but runOnboard runs inside waitUntil.
    const row = rows.get(body.onboardId)
    expect(row).toBeDefined()
    expect(row.seller_eoa).toBe(SELLER)
    // Status is one of {running, succeeded} depending on event-loop order
    // since the mock resolves synchronously. We just assert the row was
    // created and not blown away.
    expect(['running', 'succeeded']).toContain(row.status)

    // Await the background work
    await Promise.all(waitPromises)

    // runOnboard called with exact args (mock-passthrough feedback: assert shape, not just count)
    expect(runOnboardMock).toHaveBeenCalledTimes(1)
    const [onboardEnv, onboardArgs] = runOnboardMock.mock.calls[0]!
    expect(onboardEnv).toMatchObject({
      ETH_SEPOLIA_RPC_PRIMARY: 'https://eth-sepolia.test',
      BASE_SEPOLIA_RPC_PRIMARY: 'https://base-sepolia.test',
      SPLITTER_FACTORY_ADDRESS: env.SPLITTER_FACTORY_ADDRESS,
      GATEWAY_BASE_URL: 'https://gateway.test',
      FACILITATOR_BASE_URL: 'https://facilitator.test',
      CHAIN_ID_BASE_SEPOLIA: 84532,
    })
    expect(onboardArgs).toMatchObject({
      name: 'seller9.reckon402-test.eth',
      parentName: 'reckon402-test.eth',
      label: 'seller9',
      sellerEoa: SELLER,
      endpoint: 'https://agent.reckon402.com/research',
      amount: '100000',
      enableL4dEscrow: false,    // default when the request body omits the flag
    })
    expect(typeof onboardArgs.progressSink).toBe('function')

    // After waitUntil resolves: status → 'succeeded', result_json populated
    const finalRow = rows.get(body.onboardId)
    expect(finalRow.status).toBe('succeeded')
    expect(JSON.parse(finalRow.result_json).agentId).toBe('3')
  })

  test('missing required fields → 422', async () => {
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)
    const res = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'seller9.reckon402-test.eth' }),
      }),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(422)
  })

  test('enableL4dEscrow=true with all L4d env vars set → 202 + flag + L4d env threaded into runOnboard', async () => {
    runOnboardMock.mockClear()
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env: Env = {
      ...makeEnv(db),
      ESCROW_FACTORY_ADDRESS: getAddress('0xb06998682bd716e0864257b3ac3aa1fc4cc64589'),
      TIER_STRATEGY_ADDRESS:  getAddress('0xc498155bc4a2e4ba979ad5797298107c63b26c4e'),
      FACILITATOR_FEE_EOA:    getAddress('0x0a0228e6a5e1d7be234a190a8d9a3af9e08ec455'),
    }

    const SELLER = getAddress('0xd53f000000000000000000000000000000000010')
    const waitPromises: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => waitPromises.push(p) } as ExecutionContext

    const res = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            'seller10.reckon402-test.eth',
          sellerEoa:       SELLER,
          endpoint:        'https://seller10.example.com/hello',
          amount:          '10000',
          enableL4dEscrow: true,
        }),
      }),
      env, ctx,
    )
    expect(res.status).toBe(202)
    await Promise.all(waitPromises)

    expect(runOnboardMock).toHaveBeenCalledTimes(1)
    const [onboardEnv, onboardArgs] = runOnboardMock.mock.calls[0]!

    expect(onboardArgs.enableL4dEscrow).toBe(true)
    expect(onboardEnv).toMatchObject({
      ESCROW_FACTORY_ADDRESS: env.ESCROW_FACTORY_ADDRESS,
      TIER_STRATEGY_ADDRESS:  env.TIER_STRATEGY_ADDRESS,
      FACILITATOR_FEE_EOA:    env.FACILITATOR_FEE_EOA,
    })
  })

  test('enableL4dEscrow=true but ESCROW_FACTORY_ADDRESS missing → 503 l4d_not_configured (no runOnboard, no DB row)', async () => {
    runOnboardMock.mockClear()
    const { default: worker } = await import('../src/index.js')
    const { db, rows } = makeFakeDb()
    // makeEnv() omits the L4d trio — they're optional.
    const env = makeEnv(db)

    const res = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            'seller10.reckon402-test.eth',
          sellerEoa:       getAddress('0xd53f000000000000000000000000000000000010'),
          endpoint:        'https://seller10.example.com/hello',
          amount:          '10000',
          enableL4dEscrow: true,
        }),
      }),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string; detail: string }
    expect(body.error).toBe('l4d_not_configured')
    expect(body.detail).toMatch(/ESCROW_FACTORY_ADDRESS.*TIER_STRATEGY_ADDRESS.*FACILITATOR_FEE_EOA/s)

    expect(runOnboardMock).not.toHaveBeenCalled()
    expect(rows.size).toBe(0)
  })

  test('malformed ENS name (no dots) → 422', async () => {
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)
    const res = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'seller9',
          sellerEoa: getAddress('0xd53f000000000000000000000000000000000001'),
          endpoint: 'https://e.test',
          amount: '100000',
        }),
      }),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(422)
  })
})

describe('GET /onboard/:id/status', () => {
  test('returns 404 for unknown id', async () => {
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)
    const res = await worker.fetch(
      new Request('https://app.test/onboard/' + 'a'.repeat(32) + '/status'),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(404)
  })

  test('returns 422 for malformed id', async () => {
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)
    const res = await worker.fetch(
      new Request('https://app.test/onboard/not-hex/status'),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(422)
  })

  test('round-trip: POST then GET returns current progress', async () => {
    runOnboardMock.mockClear()
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)

    const waitPromises: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => waitPromises.push(p) } as ExecutionContext

    const postRes = await worker.fetch(
      new Request('https://app.test/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'seller9.reckon402-test.eth',
          sellerEoa: getAddress('0xd53f000000000000000000000000000000000001'),
          endpoint: 'https://agent.test/x',
          amount: '100000',
        }),
      }), env, ctx,
    )
    const { onboardId } = await postRes.json() as { onboardId: string }
    await Promise.all(waitPromises)

    const getRes = await worker.fetch(
      new Request(`https://app.test/onboard/${onboardId}/status`),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(getRes.status).toBe(200)
    const status = await getRes.json() as any
    expect(status.ensName).toBe('seller9.reckon402-test.eth')
    expect(status.status).toBe('succeeded')
    expect(status.steps.length).toBeGreaterThan(0)
  })
})

describe('GET /healthz', () => {
  test('returns 200 when DB responds', async () => {
    const { default: worker } = await import('../src/index.js')
    const { db } = makeFakeDb()
    const env = makeEnv(db)
    const res = await worker.fetch(
      new Request('https://app.test/healthz'),
      env, { waitUntil: () => {} } as ExecutionContext,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
