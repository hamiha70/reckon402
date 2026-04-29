import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() factory bodies are hoisted to the top of the file — any
// outer variable they reference must be declared via vi.hoisted() so
// the spies exist before the factories run.
const { giveFeedbackSpy, waitForTransactionReceiptSpy, resolveAgentIdSpy } = vi.hoisted(() => ({
  giveFeedbackSpy: vi.fn(),
  waitForTransactionReceiptSpy: vi.fn(),
  resolveAgentIdSpy: vi.fn(),
}))

// Mock the ERC-8004 client so giveFeedback is a spy we can drive.
vi.mock('@reckon402/erc-8004-client', () => ({
  reputation: { giveFeedback: giveFeedbackSpy },
}))

// Mock viem to inject controllable clients. createWalletClient is a stub;
// waitForTransactionReceipt is the spy we drive.
vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      waitForTransactionReceipt: waitForTransactionReceiptSpy,
    })),
    createWalletClient: vi.fn(() => ({})),
  }
})

// Mock the agent resolver — we're testing the attestation path, not
// resolution (which has its own test file).
vi.mock('../src/treasury/agent-resolver.js', () => ({
  resolveAgentId: resolveAgentIdSpy,
}))

import { maybeWriteAttestation, type AttestationEnv, type AttestationInput } from '../src/treasury/attestation.js'
import type { D1Database } from '@cloudflare/workers-types'

const PAYMENT_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const TRANSFER_TX = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const DIST_TX = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const
const ATT_TX = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const
const SELLER = '0xD53ffac42496d73B3Faf946786688a8454F57b1f'
const SPLITTER = '0x0ad507c6973eba86313794329ad9b12fbf24acd0'

type SqlCall = { sql: string; args: unknown[] }

function makeFakeDb() {
  const attestations = new Map<string, Record<string, unknown>>()
  const receiptUpdates: Record<string, string> = {}
  const calls: SqlCall[] = []

  function keyOf(paymentId: string, agentId: number) {
    return `${paymentId}:${agentId}`
  }

  function apply(sql: string, args: unknown[]): { changes: number } {
    if (/INSERT OR IGNORE INTO attestations/i.test(sql)) {
      const k = keyOf(String(args[0]), Number(args[1]))
      if (attestations.has(k)) return { changes: 0 }
      // The attestation.ts module emits two distinct INSERT shapes:
      //   FAILED-literal path:
      //     (payment_id, agent_id, 'FAILED', written_at, tag1, tag2, value, decimals, failure_detail)
      //     → 8 ? params + one SQL-literal 'FAILED'
      //   SUCCESS / receipt-timeout path:
      //     (payment_id, agent_id, reputation_tx, written_at, tag1, tag2, value, decimals [, failure_detail])
      //     → 8 or 9 ? params
      // The disambiguator is whether `'FAILED'` appears literally in the SQL.
      const hasLiteralFailed = /'FAILED'/.test(sql)
      if (hasLiteralFailed) {
        attestations.set(k, {
          payment_id: String(args[0]),
          agent_id: Number(args[1]),
          reputation_tx: 'FAILED',
          written_at: Number(args[2]),
          feedback_tag1: String(args[3]),
          feedback_tag2: String(args[4]),
          feedback_value: Number(args[5]),
          feedback_decimals: Number(args[6]),
          failure_detail: args[7] === undefined ? null : String(args[7]),
        })
      } else {
        attestations.set(k, {
          payment_id: String(args[0]),
          agent_id: Number(args[1]),
          reputation_tx: String(args[2]),
          written_at: Number(args[3]),
          feedback_tag1: String(args[4]),
          feedback_tag2: String(args[5]),
          feedback_value: Number(args[6]),
          feedback_decimals: Number(args[7]),
          failure_detail: args[8] === undefined ? null : String(args[8]),
        })
      }
      return { changes: 1 }
    }
    if (/UPDATE receipts SET td_erc8004_tx/i.test(sql)) {
      receiptUpdates[String(args[0])] = String(args[1])
      return { changes: 1 }
    }
    return { changes: 0 }
  }

  return {
    attestations,
    receiptUpdates,
    calls,
    seedAttestation(paymentId: string, agentId: number) {
      attestations.set(keyOf(paymentId, agentId), {
        payment_id: paymentId,
        agent_id: agentId,
        reputation_tx: 'already-here',
        written_at: 0,
        feedback_tag1: 'payment',
        feedback_tag2: 'x402-settlement',
        feedback_value: 1,
        feedback_decimals: 0,
        failure_detail: null,
      })
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args })
          return {
            async run() { return { meta: apply(sql, args) } },
            async first<T = unknown>(): Promise<T | null> {
              if (/SELECT 1 AS hit FROM attestations WHERE payment_id = \?1 AND agent_id = \?2/i.test(sql)) {
                return (attestations.get(keyOf(String(args[0]), Number(args[1]))) ? ({ hit: 1 } as unknown as T) : null)
              }
              return null
            },
          }
        },
      }
    },
  }
}

function baseEnv(db: ReturnType<typeof makeFakeDb>, overrides: Partial<AttestationEnv> = {}): AttestationEnv {
  return {
    DB: db as unknown as D1Database,
    FACILITATOR_PK: '0x' + '11'.repeat(32),
    BASE_SEPOLIA_RPC_PRIMARY: 'https://unused.local',
    SPLITTER_ADDRESS: SPLITTER,
    ENABLE_ERC8004_WRITES: 'true',
    ERC8004_CHAIN_ID: '84532',
    SELLER_AGENT_IDS: `{"${SELLER.toLowerCase()}":"1"}`,
    GATEWAY_CACHE_HOOK_URL: 'https://gw.local/hooks/cache-invalidate',
    GATEWAY_CACHE_HOOK_TOKEN: 'hooktoken',
    ATTESTATION_FEEDBACK_URI_PREFIX: 'https://f.local/x402/receipt/',
    ...overrides,
  }
}

const INPUT: AttestationInput = {
  paymentId: PAYMENT_ID,
  transferTx: TRANSFER_TX,
  distributeTx: DIST_TX,
  authValue: '10000',
}

beforeEach(() => {
  giveFeedbackSpy.mockReset()
  waitForTransactionReceiptSpy.mockReset()
  resolveAgentIdSpy.mockReset()
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})

describe('maybeWriteAttestation — guard short-circuits', () => {
  it('Guard 1: ENABLE_ERC8004_WRITES="false" — no D1 query, no giveFeedback, no fetch', async () => {
    const db = makeFakeDb()
    await maybeWriteAttestation(baseEnv(db, { ENABLE_ERC8004_WRITES: 'false' }), INPUT)
    expect(db.calls).toHaveLength(0)
    expect(resolveAgentIdSpy).not.toHaveBeenCalled()
    expect(giveFeedbackSpy).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('Guard 2: ERC8004_CHAIN_ID malformed — no giveFeedback, error logged', async () => {
    const db = makeFakeDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await maybeWriteAttestation(baseEnv(db, { ERC8004_CHAIN_ID: 'not-a-number' }), INPUT)
    expect(giveFeedbackSpy).not.toHaveBeenCalled()
    expect(resolveAgentIdSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it('Guard 3: resolveAgentId returns null — silent skip, no giveFeedback', async () => {
    const db = makeFakeDb()
    resolveAgentIdSpy.mockResolvedValue(null)
    await maybeWriteAttestation(baseEnv(db), INPUT)
    expect(resolveAgentIdSpy).toHaveBeenCalledOnce()
    expect(giveFeedbackSpy).not.toHaveBeenCalled()
    expect(db.calls).toHaveLength(0)
  })

  it('Guard 4: idempotency — existing row short-circuits before giveFeedback', async () => {
    const db = makeFakeDb()
    db.seedAttestation(PAYMENT_ID, 1)
    resolveAgentIdSpy.mockResolvedValue(1n)
    await maybeWriteAttestation(baseEnv(db), INPUT)
    expect(giveFeedbackSpy).not.toHaveBeenCalled()
    // SELECT was executed once; no further writes.
    expect(db.calls.filter((c) => /SELECT/i.test(c.sql))).toHaveLength(1)
    expect(db.calls.filter((c) => /INSERT|UPDATE/i.test(c.sql))).toHaveLength(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('maybeWriteAttestation — happy path', () => {
  it('calls giveFeedback with exact args, persists success row, invalidates cache', async () => {
    const db = makeFakeDb()
    resolveAgentIdSpy.mockResolvedValue(1n)
    giveFeedbackSpy.mockResolvedValue(ATT_TX)
    waitForTransactionReceiptSpy.mockResolvedValue({ status: 'success', blockNumber: 999n })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{}', { status: 200 }),
    )

    await maybeWriteAttestation(baseEnv(db), INPUT)

    // ARGUMENT-ASSERTION DISCIPLINE — per feedback_testing memory:
    // enforcement interfaces MUST be called with exact args, not just "any".
    expect(giveFeedbackSpy).toHaveBeenCalledOnce()
    const [gfArgs] = giveFeedbackSpy.mock.calls[0] as [
      {
        chainId: number
        agentId: bigint
        value: bigint
        valueDecimals: number
        tag1: string
        tag2: string
        endpoint: string
        feedbackURI: string
        feedbackHash: `0x${string}`
      },
    ]
    expect(gfArgs.chainId).toBe(84532)
    expect(gfArgs.agentId).toBe(1n)
    expect(gfArgs.value).toBe(1n)
    expect(gfArgs.valueDecimals).toBe(0)
    expect(gfArgs.tag1).toBe('payment')
    expect(gfArgs.tag2).toBe('x402-settlement')
    expect(gfArgs.endpoint).toBe('https://facilitator.reckon402.com/x402/settle')
    expect(gfArgs.feedbackURI).toBe(`https://f.local/x402/receipt/${PAYMENT_ID}`)
    expect(gfArgs.feedbackHash).toMatch(/^0x[0-9a-f]{64}$/)

    // Success row persisted with the correct shape.
    const row = db.attestations.get(`${PAYMENT_ID}:1`)
    expect(row).toBeDefined()
    expect(row?.reputation_tx).toBe(ATT_TX)
    expect(row?.feedback_tag1).toBe('payment')
    expect(row?.feedback_tag2).toBe('x402-settlement')
    expect(row?.feedback_value).toBe(1)
    expect(row?.failure_detail).toBeNull()

    // receipts.td_erc8004_tx populated on success.
    expect(db.receiptUpdates[PAYMENT_ID]).toBe(ATT_TX)

    // Gateway cache-invalidate called with correct body + bearer.
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw.local/hooks/cache-invalidate')
    expect(opts.method).toBe('POST')
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer hooktoken')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body as string) as { chainId: number; agentId: string; keys: string[] }
    expect(body.chainId).toBe(84532)
    expect(body.agentId).toBe('1')
    expect(body.keys).toEqual(['reputation.getClients', 'reputation.getSummary'])
  })
})

describe('maybeWriteAttestation — failure paths', () => {
  it('giveFeedback throws → FAILED row with failure_detail; no receipts update; no fetch', async () => {
    const db = makeFakeDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveAgentIdSpy.mockResolvedValue(1n)
    giveFeedbackSpy.mockRejectedValue(new Error('gas estimation failed: execution reverted'))

    await maybeWriteAttestation(baseEnv(db), INPUT)

    const row = db.attestations.get(`${PAYMENT_ID}:1`)
    expect(row).toBeDefined()
    expect(row?.reputation_tx).toBe('FAILED')
    expect(row?.failure_detail).toMatch(/gas estimation failed/)
    // No receipts update on failure.
    expect(db.receiptUpdates[PAYMENT_ID]).toBeUndefined()
    // No cache-invalidate on failure.
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it('tx reverts on-chain (receipt.status=reverted) → FAILED row; no receipts update', async () => {
    const db = makeFakeDb()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveAgentIdSpy.mockResolvedValue(1n)
    giveFeedbackSpy.mockResolvedValue(ATT_TX)
    waitForTransactionReceiptSpy.mockResolvedValue({ status: 'reverted', blockNumber: 42n })

    await maybeWriteAttestation(baseEnv(db), INPUT)

    const row = db.attestations.get(`${PAYMENT_ID}:1`)
    expect(row?.reputation_tx).toBe('FAILED')
    expect(row?.failure_detail).toMatch(/reverted_at_block_42/)
    expect(db.receiptUpdates[PAYMENT_ID]).toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('cache-invalidate fetch fails → attestation row still written; function resolves', async () => {
    const db = makeFakeDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveAgentIdSpy.mockResolvedValue(1n)
    giveFeedbackSpy.mockResolvedValue(ATT_TX)
    waitForTransactionReceiptSpy.mockResolvedValue({ status: 'success', blockNumber: 100n })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'))

    await expect(maybeWriteAttestation(baseEnv(db), INPUT)).resolves.toBeUndefined()

    // Attestation row still written successfully.
    const row = db.attestations.get(`${PAYMENT_ID}:1`)
    expect(row?.reputation_tx).toBe(ATT_TX)
    expect(db.receiptUpdates[PAYMENT_ID]).toBe(ATT_TX)
    expect(errSpy).toHaveBeenCalled()
  })

  it('missing GATEWAY_CACHE_HOOK_TOKEN → skip cache-invalidate silently; row still written', async () => {
    const db = makeFakeDb()
    resolveAgentIdSpy.mockResolvedValue(1n)
    giveFeedbackSpy.mockResolvedValue(ATT_TX)
    waitForTransactionReceiptSpy.mockResolvedValue({ status: 'success', blockNumber: 100n })

    const env = baseEnv(db)
    delete (env as { GATEWAY_CACHE_HOOK_TOKEN?: string }).GATEWAY_CACHE_HOOK_TOKEN

    await maybeWriteAttestation(env, INPUT)

    const row = db.attestations.get(`${PAYMENT_ID}:1`)
    expect(row?.reputation_tx).toBe(ATT_TX)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
