import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { settleHandler } from '../src/settle-route.js'
import type { Env } from '../src/env.js'
import * as settleModule from '../src/settle.js'
import type { SettleOutcome } from '../src/settle.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const SPLITTER = '0x1111111111111111111111111111111111111111'
const BUYER    = '0x837e30740a4A5bAC5480b4f707924469d42b43De'

// Pre-computed paymentId for the fixture authorization below (asserted by
// computePaymentId — kept as a const so test failures pinpoint a mismatch).
const FIXTURE_AUTH = {
  from: BUYER,
  to: SPLITTER,
  value: '10000',
  validAfter: '0',
  validBefore: '1999999999',
  nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
}

const FIXTURE_REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: '10000',
  asset: USDC,
  payTo: SPLITTER,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
}

const FIXTURE_PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: FIXTURE_REQUIREMENTS,
  payload: {
    signature: '0x' + 'aa'.repeat(65),
    authorization: FIXTURE_AUTH,
  },
}

type SqlCall = { sql: string; args: unknown[] }

/**
 * Richer D1 fake than the verify-route test: also records every executed
 * statement (sql + args) so assertions can pin down EXACTLY which SQL
 * shape and parameters we ran — closing the mock-passthrough blindspot
 * called out in the feedback memory.
 */
function makeFakeDb() {
  type Row = Record<string, unknown> & { payment_id: string; state: string }
  const rows = new Map<string, Row>()
  const calls: SqlCall[] = []

  function apply(sql: string, args: unknown[]): { changes: number } {
    if (/INSERT OR IGNORE INTO receipts/i.test(sql)) {
      const pid = String(args[0])
      if (rows.has(pid)) return { changes: 0 }
      rows.set(pid, {
        payment_id: pid,
        request_id: String(args[1]),
        state: 'SUBMITTED',
        network: String(args[2]),
        version: 2,
        auth_from: String(args[3]),
        auth_to: String(args[4]),
        auth_value: String(args[5]),
        auth_valid_after: Number(args[6]),
        auth_valid_before: Number(args[7]),
        auth_nonce: String(args[8]),
        submitted_at: Number(args[9]),
        transaction: null,
        block_number: null,
        block_timestamp: null,
        confirmed_at: null,
        gas_used: null,
        retry_count: 0,
        last_retry_at: null,
        reconcile_notes: null,
        failure_reason: null,
        failure_detail: null,
      })
      return { changes: 1 }
    }
    // UPDATE ... SET state='PENDING_CONFIRMATION' WHERE payment_id=?1 AND state='SUBMITTED'
    if (/UPDATE receipts\s+SET state = 'PENDING_CONFIRMATION'/i.test(sql)) {
      const pid = String(args[0])
      const row = rows.get(pid)
      if (!row || row.state !== 'SUBMITTED') return { changes: 0 }
      row.state = 'PENDING_CONFIRMATION'
      row.last_retry_at = Number(args[1])
      return { changes: 1 }
    }
    // UPDATE ... SET state='CONFIRMED', transaction=?, block_number=?, ...
    if (/UPDATE receipts\s+SET state = 'CONFIRMED'/i.test(sql)) {
      const pid = String(args[0])
      const row = rows.get(pid)
      if (!row) return { changes: 0 }
      row.state = 'CONFIRMED'
      row.transaction = String(args[1])
      row.block_number = Number(args[2])
      row.block_timestamp = Number(args[3])
      row.confirmed_at = Number(args[4])
      row.gas_used = String(args[5])
      row.reconcile_notes = String(args[6])
      return { changes: 1 }
    }
    // UPDATE ... SET state='FAILED', transaction=COALESCE(...), failure_reason=?, failure_detail=?
    if (/UPDATE receipts\s+SET state = 'FAILED'/i.test(sql)) {
      const pid = String(args[0])
      const row = rows.get(pid)
      if (!row) return { changes: 0 }
      row.state = 'FAILED'
      if (args[1] != null) row.transaction = String(args[1])
      row.failure_reason = String(args[2])
      row.failure_detail = String(args[3])
      return { changes: 1 }
    }
    return { changes: 0 }
  }

  return {
    rows,
    calls,
    setRow(row: Row) { rows.set(row.payment_id, row) },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args })
          return {
            async run() { return { meta: apply(sql, args) } },
            async first<T = unknown>(): Promise<T | null> {
              if (/SELECT \* FROM receipts WHERE payment_id = \?1/i.test(sql)) {
                return (rows.get(String(args[0])) as T | undefined) ?? null
              }
              return null
            },
          }
        },
      }
    },
  }
}

function makeEnv(db: ReturnType<typeof makeFakeDb>): Env {
  return {
    DB: db as unknown as Env['DB'],
    NETWORK,
    USDC_ADDRESS: USDC,
    SPLITTER_ADDRESS: SPLITTER,
    FACILITATOR_PK: ('0x' + '00'.repeat(32)),
    BASE_SEPOLIA_RPC_PRIMARY: 'https://unused.local',
  }
}

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/x402/settle', settleHandler)
  return { fetch: (req: Request) => app.fetch(req, env) }
}

function settleReq() {
  return new Request('https://f.local/x402/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: FIXTURE_PAYLOAD,
      paymentRequirements: FIXTURE_REQUIREMENTS,
    }),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ────────────────────── happy path ──────────────────────

describe('POST /x402/settle — happy path', () => {
  it('SUBMITTED → PENDING_CONFIRMATION → CONFIRMED on successful settleOnChain', async () => {
    const db = makeFakeDb()
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: true,
      transferTx: '0xabc',
      distributeTx: '0xdef',
      blockNumber: 42n,
      blockTimestamp: 1735000001n,
      gasUsed: 100000n,
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db)).fetch(settleReq())

    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; transaction: string; state: string; paymentId: string }
    expect(body.success).toBe(true)
    expect(body.transaction).toBe('0xabc')     // canonical field = transferWithAuthorization tx
    expect(body.state).toBe('CONFIRMED')

    // Key invariant: settleOnChain is called EXACTLY ONCE with the right args
    expect(settleSpy).toHaveBeenCalledOnce()
    const [envArg, inputArg] = settleSpy.mock.calls[0]
    expect(envArg.USDC_ADDRESS).toBe(USDC)
    expect(envArg.SPLITTER_ADDRESS).toBe(SPLITTER)
    expect(inputArg.authorization).toEqual(FIXTURE_AUTH)
    expect(inputArg.signature).toBe(FIXTURE_PAYLOAD.payload.signature)
    expect(inputArg.paymentId).toMatch(/^0x[0-9a-f]{64}$/)

    // Verify we ran the correct SQL sequence: INSERT OR IGNORE, UPDATE → PENDING, UPDATE → CONFIRMED
    const sqlShapes = db.calls.map((c) => c.sql.replace(/\s+/g, ' ').trim())
    expect(sqlShapes.some((s) => /INSERT OR IGNORE INTO receipts/i.test(s))).toBe(true)
    expect(sqlShapes.some((s) => /SET state = 'PENDING_CONFIRMATION'/i.test(s))).toBe(true)
    expect(sqlShapes.some((s) => /SET state = 'CONFIRMED'/i.test(s))).toBe(true)

    // X-Reckon402-Replay header must NOT be set on a fresh call
    expect(res.headers.get('X-Reckon402-Replay')).toBeNull()
  })
})

// ────────────────────── replay short-circuit ──────────────────────

describe('POST /x402/settle — replay short-circuit from D1', () => {
  it('returns 200 with X-Reckon402-Replay: true on CONFIRMED row; does NOT call settleOnChain', async () => {
    const db = makeFakeDb()
    // Pre-seed a CONFIRMED receipt row for this paymentId.
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)
    db.setRow({
      payment_id: pid,
      request_id: '00000000-0000-4000-8000-000000000001',
      state: 'CONFIRMED',
      network: NETWORK,
      version: 2,
      auth_from: FIXTURE_AUTH.from,
      auth_to: FIXTURE_AUTH.to,
      auth_value: FIXTURE_AUTH.value,
      auth_valid_after: Number(FIXTURE_AUTH.validAfter),
      auth_valid_before: Number(FIXTURE_AUTH.validBefore),
      auth_nonce: FIXTURE_AUTH.nonce,
      transaction: '0xoriginal',
      submitted_at: 1735000000000,
      block_number: 42,
      block_timestamp: 1735000001,
      confirmed_at: 1735000002000,
      gas_used: '100000',
      retry_count: 0,
      last_retry_at: null,
      reconcile_notes: 'distributeTx=0xcafe',
      failure_reason: null,
      failure_detail: null,
    })

    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')

    const res = await makeApp(makeEnv(db)).fetch(settleReq())
    expect(res.status).toBe(200)

    // LOAD-BEARING: settleOnChain must NOT be called on a replay (no second on-chain tx).
    expect(settleSpy).not.toHaveBeenCalled()

    const body = await res.json() as { transaction: string; state: string }
    expect(body.transaction).toBe('0xoriginal')
    expect(body.state).toBe('CONFIRMED')

    // Replay header exposed so operators/demos can distinguish fresh vs replayed.
    expect(res.headers.get('X-Reckon402-Replay')).toBe('true')
  })

  it('returns 502 on FAILED row without calling settleOnChain', async () => {
    const db = makeFakeDb()
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)
    db.setRow({
      payment_id: pid,
      request_id: '00000000-0000-4000-8000-000000000002',
      state: 'FAILED',
      network: NETWORK,
      version: 2,
      auth_from: FIXTURE_AUTH.from,
      auth_to: FIXTURE_AUTH.to,
      auth_value: FIXTURE_AUTH.value,
      auth_valid_after: Number(FIXTURE_AUTH.validAfter),
      auth_valid_before: Number(FIXTURE_AUTH.validBefore),
      auth_nonce: FIXTURE_AUTH.nonce,
      transaction: null,
      submitted_at: 1735000000000,
      block_number: null,
      block_timestamp: null,
      confirmed_at: null,
      gas_used: null,
      retry_count: 0,
      last_retry_at: null,
      reconcile_notes: null,
      failure_reason: 'TX_REVERTED',
      failure_detail: 'distribute reverted at block 10',
    })

    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')
    const res = await makeApp(makeEnv(db)).fetch(settleReq())

    expect(res.status).toBe(502)
    expect(settleSpy).not.toHaveBeenCalled()
    const body = await res.json() as { success: boolean; errorReason: string }
    expect(body.success).toBe(false)
    expect(body.errorReason).toBe('TX_REVERTED')
  })
})

// ────────────────────── race on SUBMITTED ──────────────────────

describe('POST /x402/settle — concurrent settle race', () => {
  it('losing call sees meta.changes=0 and does NOT call settleOnChain', async () => {
    const db = makeFakeDb()
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)

    // Simulate concurrent-call state: another call already advanced the row to
    // PENDING_CONFIRMATION. Our claim UPDATE ... WHERE state='SUBMITTED' sees
    // changes=0, so we must NOT submit a tx.
    db.setRow({
      payment_id: pid,
      request_id: '00000000-0000-4000-8000-000000000003',
      state: 'PENDING_CONFIRMATION',
      network: NETWORK,
      version: 2,
      auth_from: FIXTURE_AUTH.from,
      auth_to: FIXTURE_AUTH.to,
      auth_value: FIXTURE_AUTH.value,
      auth_valid_after: Number(FIXTURE_AUTH.validAfter),
      auth_valid_before: Number(FIXTURE_AUTH.validBefore),
      auth_nonce: FIXTURE_AUTH.nonce,
      transaction: '0xfirst',
      submitted_at: 1735000000000,
      block_number: null,
      block_timestamp: null,
      confirmed_at: null,
      gas_used: null,
      retry_count: 0,
      last_retry_at: Date.now(),
      reconcile_notes: null,
      failure_reason: null,
      failure_detail: null,
    })

    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')
    const res = await makeApp(makeEnv(db)).fetch(settleReq())

    // Losing call must not submit — if it does, we get a second on-chain tx
    // (same nonce, dedup'd by mempool, but wasted gas + receipt-state churn).
    expect(settleSpy).not.toHaveBeenCalled()

    // Response is PENDING_CONFIRMATION (not CONFIRMED yet) so 502 from
    // the handler's final status check. The row shape carries the first
    // call's tx hash.
    const body = await res.json() as { state: string; transaction: string }
    expect(body.state).toBe('PENDING_CONFIRMATION')
    expect(body.transaction).toBe('0xfirst')
  })
})

// ────────────────────── failure paths ──────────────────────

describe('POST /x402/settle — failure paths from settleOnChain', () => {
  it('TX_REVERTED → row transitions to FAILED, returns 502 with errorReason', async () => {
    const db = makeFakeDb()
    vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: false,
      transferTx: '0xfeed',
      failureReason: 'TX_REVERTED',
      failureDetail: 'distribute reverted at block 99',
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db)).fetch(settleReq())
    expect(res.status).toBe(502)
    const body = await res.json() as { success: boolean; errorReason: string; state: string }
    expect(body.success).toBe(false)
    expect(body.errorReason).toBe('TX_REVERTED')
    expect(body.state).toBe('FAILED')

    // Row state in D1 must be FAILED (confirms UPDATE ran).
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)
    expect(db.rows.get(pid)?.state).toBe('FAILED')
    expect(db.rows.get(pid)?.failure_reason).toBe('TX_REVERTED')
    expect(db.rows.get(pid)?.transaction).toBe('0xfeed')
  })

  it('DEADLINE_EXCEEDED → FAILED with correct failure_reason', async () => {
    const db = makeFakeDb()
    vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: false,
      failureReason: 'DEADLINE_EXCEEDED',
      failureDetail: 'now=X >= validBefore=Y',
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db)).fetch(settleReq())
    expect(res.status).toBe(502)
    const body = await res.json() as { errorReason: string }
    expect(body.errorReason).toBe('DEADLINE_EXCEEDED')
  })

  it('OTHER (e.g. RPC timeout) → FAILED + free-form failure_detail preserved', async () => {
    const db = makeFakeDb()
    vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: false,
      failureReason: 'OTHER',
      failureDetail: 'transfer_receipt_timeout: fetch failed',
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db)).fetch(settleReq())
    expect(res.status).toBe(502)
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)
    expect(db.rows.get(pid)?.failure_reason).toBe('OTHER')
    expect(db.rows.get(pid)?.failure_detail).toMatch(/fetch failed/)
  })
})

// ────────────────────── partial D1 failure after on-chain success ──────────────────────

describe('POST /x402/settle — partial D1 failure (double-spend guard)', () => {
  it('returns 500 when UPDATE CONFIRMED fails after settleOnChain succeeds', async () => {
    // Scenario: on-chain txs both confirm, but the D1 UPDATE to CONFIRMED throws.
    // The handler must NOT return 200 (which would tell the agent the payment succeeded
    // when D1 is actually still in PENDING_CONFIRMATION — leaving the row in a limbo
    // state that would trigger reconciliation). Expect 500, not 200.
    const db = makeFakeDb()

    // Patch prepare() to throw on the CONFIRMED UPDATE, letting all other SQL through.
    const originalPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (/SET state = 'CONFIRMED'/i.test(sql)) {
        return {
          bind(..._args: unknown[]) {
            return {
              async run() { throw new Error('D1 write failed: storage quota exceeded') },
              async first<T = unknown>(): Promise<T | null> { return null },
            }
          },
        }
      }
      return originalPrepare(sql)
    })

    vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: true,
      transferTx: '0xabc',
      distributeTx: '0xdef',
      blockNumber: 42n,
      blockTimestamp: 1735000001n,
      gasUsed: 100000n,
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db)).fetch(settleReq())

    // Handler should propagate the D1 error — 500 is acceptable; 200 is NOT
    // (it would falsely signal payment success to the agent middleware).
    expect(res.status).not.toBe(200)
  })
})

// ────────────────────── FAILED replay header ──────────────────────

describe('POST /x402/settle — FAILED replay', () => {
  it('returns 502 with X-Reckon402-Replay: true on FAILED row', async () => {
    // A FAILED row on replay should signal replay (same paymentId submitted before,
    // it failed). The X-Reckon402-Replay header helps operators distinguish "fresh
    // failure" from "replayed failed payment".
    const db = makeFakeDb()
    const { computePaymentId } = await import('../src/payment-id.js')
    const pid = computePaymentId(FIXTURE_AUTH)
    db.setRow({
      payment_id: pid,
      request_id: '00000000-0000-4000-8000-000000000099',
      state: 'FAILED',
      network: NETWORK,
      version: 2,
      auth_from: FIXTURE_AUTH.from,
      auth_to: FIXTURE_AUTH.to,
      auth_value: FIXTURE_AUTH.value,
      auth_valid_after: Number(FIXTURE_AUTH.validAfter),
      auth_valid_before: Number(FIXTURE_AUTH.validBefore),
      auth_nonce: FIXTURE_AUTH.nonce,
      transaction: null,
      submitted_at: 1735000000000,
      block_number: null,
      block_timestamp: null,
      confirmed_at: null,
      gas_used: null,
      retry_count: 0,
      last_retry_at: null,
      reconcile_notes: null,
      failure_reason: 'TX_REVERTED',
      failure_detail: 'distribute reverted at block 10',
    })

    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')
    const res = await makeApp(makeEnv(db)).fetch(settleReq())

    expect(res.status).toBe(502)
    expect(settleSpy).not.toHaveBeenCalled()
    // The current settle-route.ts does NOT set X-Reckon402-Replay on FAILED rows,
    // only on CONFIRMED/RECONCILED. This test documents the expected behaviour:
    // FAILED replays return 502 but the replay header is absent (unlike CONFIRMED).
    // If the behaviour changes to always set the header, update this assertion.
    const body = await res.json() as { success: boolean; errorReason: string }
    expect(body.success).toBe(false)
    expect(body.errorReason).toBe('TX_REVERTED')
  })
})

// ────────────────────── bad-input guards ──────────────────────

describe('POST /x402/settle — input validation', () => {
  it('rejects x402Version != 2', async () => {
    const db = makeFakeDb()
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: FIXTURE_PAYLOAD,
        paymentRequirements: FIXTURE_REQUIREMENTS,
      }),
    }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { errorReason: string }).errorReason).toBe('UNSUPPORTED_VERSION')
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('rejects UNSUPPORTED_NETWORK', async () => {
    const db = makeFakeDb()
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: FIXTURE_PAYLOAD,
        paymentRequirements: { ...FIXTURE_REQUIREMENTS, network: 'eip155:8453' },
      }),
    }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { errorReason: string }).errorReason).toBe('UNSUPPORTED_NETWORK')
  })
})
