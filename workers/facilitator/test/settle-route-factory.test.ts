import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { settleHandler } from '../src/settle-route.js'
import type { Env } from '../src/env.js'
import * as settleModule from '../src/settle.js'
import type { SettleOutcome } from '../src/settle.js'
import * as resolverModule from '../src/treasury/splitter-resolver.js'
import type { PaymentPayload, PaymentRequirements } from '@reckon402/types'

/**
 * Spec 08A §7.3 — L4c settle-route integration.
 *
 * Covers the ENABLE_L4C_FACTORY flag branches:
 *  - flag=false: legacy L4b₁ path; resolveSplitterForPayment NEVER called.
 *  - flag=true + resolver=null: 422 SPLITTER_UNKNOWN; no on-chain tx.
 *  - flag=true + resolver OK: resolved.splitter threaded into settleOnChain.
 *  - state machine allowlist: SPLITTER_UNKNOWN is a recognized terminal state.
 *  - L4b₁ regression: with flags off, tx hashes/shape unchanged vs the
 *    original fixture in settle-route.test.ts.
 */

const USDC       = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK    = 'eip155:84532'
const PINNED_SPL = '0x1111111111111111111111111111111111111111' // legacy env.SPLITTER_ADDRESS
const PER_SA_SPL = '0x2222222222222222222222222222222222222222' // L4c per-SellingAgent splitter
const FACTORY    = '0x3333333333333333333333333333333333333333'
const BUYER      = '0x837e30740a4A5bAC5480b4f707924469d42b43De'
const GW         = 'https://gateway.reckon402.local'
const ENS        = 'alice.reckon402.eth'

const FIXTURE_AUTH = {
  from: BUYER,
  to: PINNED_SPL,
  value: '10000',
  validAfter: '0',
  validBefore: '1999999999',
  nonce: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
}

function makeRequirements(withEns: boolean): PaymentRequirements {
  return {
    scheme: 'exact',
    network: NETWORK,
    amount: '10000',
    asset: USDC,
    payTo: PINNED_SPL,
    maxTimeoutSeconds: 300,
    extra: withEns
      ? { name: 'USDC', version: '2', ens: ENS }
      : { name: 'USDC', version: '2' },
  }
}

function makePayload(withEns: boolean): PaymentPayload {
  return {
    x402Version: 2,
    accepted: makeRequirements(withEns),
    payload: {
      signature: '0x' + 'aa'.repeat(65),
      authorization: FIXTURE_AUTH,
    },
  }
}

type SqlCall = { sql: string; args: unknown[] }

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
    if (/SET state = 'SPLITTER_UNKNOWN'/i.test(sql)) {
      const pid = String(args[0])
      const row = rows.get(pid)
      if (!row || row.state !== 'SUBMITTED') return { changes: 0 }
      row.state = 'SPLITTER_UNKNOWN'
      return { changes: 1 }
    }
    if (/SET state = 'PENDING_CONFIRMATION'/i.test(sql)) {
      const pid = String(args[0])
      const row = rows.get(pid)
      if (!row || row.state !== 'SUBMITTED') return { changes: 0 }
      row.state = 'PENDING_CONFIRMATION'
      row.last_retry_at = Number(args[1])
      return { changes: 1 }
    }
    if (/SET state = 'CONFIRMED'/i.test(sql)) {
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
    return { changes: 0 }
  }

  return {
    rows,
    calls,
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

function makeEnv(
  db: ReturnType<typeof makeFakeDb>,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db as unknown as Env['DB'],
    NETWORK,
    USDC_ADDRESS: USDC,
    SPLITTER_ADDRESS: PINNED_SPL,
    FACILITATOR_PK: ('0x' + '00'.repeat(32)),
    BASE_SEPOLIA_RPC_PRIMARY: 'https://unused.local',
    ENABLE_ERC8004_WRITES: 'false',
    ERC8004_CHAIN_ID: '84532',
    SELLER_AGENT_IDS: '{}',
    GATEWAY_CACHE_HOOK_URL: 'https://unused.local/hooks/cache-invalidate',
    ATTESTATION_FEEDBACK_URI_PREFIX: 'https://unused.local/x402/receipt/',
    SPLITTER_FACTORY_ADDRESS: FACTORY,
    GATEWAY_BASE_URL: GW,
    ENABLE_L4C_FACTORY: 'false',
    USE_LEGACY_AGENT_RESOLVER: 'true',
    ...overrides,
  }
}

const noopCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/x402/settle', settleHandler)
  return { fetch: (req: Request) => app.fetch(req, env, noopCtx) }
}

function settleReq(withEns: boolean) {
  return new Request('https://f.local/x402/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: makePayload(withEns),
      paymentRequirements: makeRequirements(withEns),
    }),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────── Case 1: flag OFF, legacy happy path ───────────────────

describe('settle-route — ENABLE_L4C_FACTORY=false (L4b₁ regression)', () => {
  it('uses env.SPLITTER_ADDRESS; resolveSplitterForPayment NEVER called', async () => {
    const db = makeFakeDb()
    const resolverSpy = vi.spyOn(resolverModule, 'resolveSplitterForPayment')
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: true,
      transferTx: '0xtransfer',
      distributeTx: '0xdist',
      blockNumber: 42n,
      blockTimestamp: 1735000001n,
      gasUsed: 100000n,
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db, { ENABLE_L4C_FACTORY: 'false' })).fetch(
      settleReq(false),
    )
    expect(res.status).toBe(200)

    // L4c resolver must never be consulted when the flag is off.
    expect(resolverSpy).not.toHaveBeenCalled()

    // settleOnChain called without a per-payment splitter — relies on env.SPLITTER_ADDRESS.
    expect(settleSpy).toHaveBeenCalledOnce()
    const [envArg, inputArg] = settleSpy.mock.calls[0]
    expect(envArg.SPLITTER_ADDRESS).toBe(PINNED_SPL)
    expect(inputArg.splitter).toBeUndefined()
  })
})

// ─────────────────── Case 2: flag ON, resolver returns null ───────────────────

describe('settle-route — ENABLE_L4C_FACTORY=true, resolver returns null', () => {
  it('writes SPLITTER_UNKNOWN to D1; responds 422; never broadcasts transferWithAuthorization', async () => {
    const db = makeFakeDb()
    const resolverSpy = vi
      .spyOn(resolverModule, 'resolveSplitterForPayment')
      .mockResolvedValue(null)
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')

    const res = await makeApp(makeEnv(db, { ENABLE_L4C_FACTORY: 'true' })).fetch(
      settleReq(true),
    )

    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; ensName: string }
    expect(body.error).toBe('splitter_unknown')
    expect(body.ensName).toBe(ENS)

    // Resolver called exactly once with the ENS from paymentRequirements.extra.
    expect(resolverSpy).toHaveBeenCalledOnce()
    const [resolverEnvArg, resolverEns] = resolverSpy.mock.calls[0]
    expect(resolverEnvArg.SPLITTER_FACTORY_ADDRESS).toBe(FACTORY)
    expect(resolverEnvArg.GATEWAY_BASE_URL).toBe(GW)
    expect(resolverEns).toBe(ENS)

    // settleOnChain must NOT have been called — no on-chain tx on forged-record case.
    expect(settleSpy).not.toHaveBeenCalled()

    // D1 row transitioned to SPLITTER_UNKNOWN.
    const rowValues = Array.from(db.rows.values())
    expect(rowValues).toHaveLength(1)
    expect(rowValues[0].state).toBe('SPLITTER_UNKNOWN')
  })

  it('missing extra.ens with flag=true → 400 MISSING_ENS; no resolver, no tx', async () => {
    const db = makeFakeDb()
    const resolverSpy = vi.spyOn(resolverModule, 'resolveSplitterForPayment')
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain')

    const res = await makeApp(makeEnv(db, { ENABLE_L4C_FACTORY: 'true' })).fetch(
      settleReq(false), // no ens in extra
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { errorReason: string }
    expect(body.errorReason).toBe('MISSING_ENS')

    expect(resolverSpy).not.toHaveBeenCalled()
    expect(settleSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────── Case 3: flag ON, resolver happy path ───────────────────

describe('settle-route — ENABLE_L4C_FACTORY=true, resolver happy path', () => {
  it('threads resolved.splitter into settleOnChain; receives agentId via resolved', async () => {
    const db = makeFakeDb()
    const resolverSpy = vi.spyOn(resolverModule, 'resolveSplitterForPayment').mockResolvedValue({
      splitter: PER_SA_SPL as `0x${string}`,
      agentId: 42n,
      ensName: ENS,
    })
    const settleSpy = vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: true,
      transferTx: '0xtransferL4c',
      distributeTx: '0xdistL4c',
      blockNumber: 100n,
      blockTimestamp: 1735000500n,
      gasUsed: 120000n,
    } satisfies SettleOutcome)

    const res = await makeApp(makeEnv(db, { ENABLE_L4C_FACTORY: 'true' })).fetch(
      settleReq(true),
    )
    expect(res.status).toBe(200)

    // Resolver consulted once with exact args.
    expect(resolverSpy).toHaveBeenCalledOnce()
    const [, resolverEns] = resolverSpy.mock.calls[0]
    expect(resolverEns).toBe(ENS)

    // settleOnChain receives resolved.splitter as input.splitter (not via env).
    expect(settleSpy).toHaveBeenCalledOnce()
    const [, inputArg] = settleSpy.mock.calls[0]
    expect(inputArg.splitter).toBe(PER_SA_SPL)

    const body = (await res.json()) as { success: boolean; transaction: string; state: string }
    expect(body.success).toBe(true)
    expect(body.transaction).toBe('0xtransferL4c')
    expect(body.state).toBe('CONFIRMED')
  })
})

// ─────────────────── Case 4: state machine allowlist ───────────────────

describe('state-machine allowlist for SPLITTER_UNKNOWN', () => {
  it('SPLITTER_UNKNOWN is a recognized terminal state (SUBMITTED → SPLITTER_UNKNOWN allowed)', async () => {
    const { assertTransition, isTerminal } = await import('../src/state-machine.js')

    expect(() => assertTransition('SUBMITTED', 'SPLITTER_UNKNOWN')).not.toThrow()
    expect(isTerminal('SPLITTER_UNKNOWN')).toBe(true)

    // No egress from SPLITTER_UNKNOWN — terminal by design (not in the reconciler sweep).
    expect(() => assertTransition('SPLITTER_UNKNOWN', 'CONFIRMED')).toThrow()
    expect(() => assertTransition('SPLITTER_UNKNOWN', 'PENDING_CONFIRMATION')).toThrow()
  })
})

// ─────────────────── Case 5: L4b₁ regression with flags off ───────────────────

describe('settle-route — L4b₁ regression with L4c flags off', () => {
  it('deterministic tx hashes + response shape unchanged vs. pre-L4c baseline', async () => {
    const db = makeFakeDb()
    vi.spyOn(settleModule, 'settleOnChain').mockResolvedValue({
      success: true,
      transferTx: '0xabc',
      distributeTx: '0xdef',
      blockNumber: 42n,
      blockTimestamp: 1735000001n,
      gasUsed: 100000n,
    } satisfies SettleOutcome)

    const res = await makeApp(
      makeEnv(db, {
        ENABLE_L4C_FACTORY: 'false',
        USE_LEGACY_AGENT_RESOLVER: 'true',
      }),
    ).fetch(settleReq(false))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; transaction: string; state: string }
    expect(body.success).toBe(true)
    expect(body.transaction).toBe('0xabc')
    expect(body.state).toBe('CONFIRMED')
  })
})
