import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyHandler } from '../src/verify.js'
import type { Env } from '../src/env.js'
import type { EIP3009Authorization, PaymentPayload, PaymentRequirements } from '@reckon402/types'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'

interface FakeRow { [k: string]: unknown }

/** Minimal D1 fake just rich enough to exercise verify.ts:
 *  - INSERT OR IGNORE into receipts (keyed by payment_id)
 *  - SELECT * FROM receipts WHERE payment_id = ?1
 *  Every other statement is a no-op. */
function makeFakeDb() {
  const rows = new Map<string, FakeRow>()
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/INSERT OR IGNORE INTO receipts/i.test(sql)) {
                const paymentId = String(args[0])
                if (!rows.has(paymentId)) {
                  rows.set(paymentId, {
                    payment_id: paymentId,
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
                  return { meta: { changes: 1 } }
                }
                return { meta: { changes: 0 } }
              }
              return { meta: { changes: 0 } }
            },
            async first<T = unknown>(): Promise<T | null> {
              if (/SELECT \* FROM receipts WHERE payment_id = \?1/i.test(sql)) {
                const paymentId = String(args[0])
                return (rows.get(paymentId) as T | undefined) ?? null
              }
              return null
            },
          }
        },
      }
    },
  }
}

async function makeValidPayload(): Promise<{
  payload: PaymentPayload
  requirements: PaymentRequirements
  buyer: `0x${string}`
}> {
  const pk = ('0x' + '11'.repeat(32)) as `0x${string}`
  const account = privateKeyToAccount(pk)

  const auth: EIP3009Authorization = {
    from: account.address,
    to:   '0x1111111111111111111111111111111111111111', // splitter-ish
    value: '10000',
    validAfter: '0',
    validBefore: String(Math.floor(Date.now() / 1000) + 600),
    nonce: ('0x' + '22'.repeat(32)) as `0x${string}`,
  }

  const signature = await account.signTypedData({
    domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: USDC },
    types: {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from as `0x${string}`,
      to:   auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as `0x${string}`,
    },
  })

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: NETWORK,
    amount: '10000',
    asset: USDC,
    payTo: auth.to,
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  }

  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { signature, authorization: auth },
  }

  return { payload, requirements, buyer: account.address }
}

function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/x402/verify', verifyHandler)
  return { fetch: (req: Request) => app.fetch(req, env) }
}

function makeEnv(db: ReturnType<typeof makeFakeDb>): Env {
  return {
    DB: db as unknown as Env['DB'],
    NETWORK,
    USDC_ADDRESS: USDC,
    SPLITTER_ADDRESS: '0x1111111111111111111111111111111111111111',
    FACILITATOR_PK: ('0x' + '00'.repeat(32)),
    BASE_SEPOLIA_RPC_PRIMARY: 'https://unused-in-verify.local',
  }
}

describe('POST /x402/verify', () => {
  it('rejects x402Version != 2', async () => {
    const db = makeFakeDb()
    const app = makeApp(makeEnv(db))
    const res = await app.fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, paymentPayload: {}, paymentRequirements: {} }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { invalidReason: string }
    expect(body.invalidReason).toBe('UNSUPPORTED_VERSION')
  })

  it('rejects wrong network', async () => {
    const { payload, requirements } = await makeValidPayload()
    const wrongReq = { ...requirements, network: 'eip155:8453' }
    const db = makeFakeDb()
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: wrongReq }),
    }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { invalidReason: string }).invalidReason).toBe('UNSUPPORTED_NETWORK')
  })

  it('rejects DEADLINE_TOO_TIGHT', async () => {
    const { payload, requirements } = await makeValidPayload()
    payload.payload.authorization.validBefore = String(Math.floor(Date.now() / 1000) + 10)
    const db = makeFakeDb()
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { invalidReason: string }).invalidReason).toBe('DEADLINE_TOO_TIGHT')
  })

  it('rejects a tampered signature (INVALID_SIGNATURE)', async () => {
    const { payload, requirements } = await makeValidPayload()
    // Flip a byte inside the r component (first 32 bytes after 0x). Tampering
    // v alone can be normalized by the recovery implementation; tampering r
    // produces a different recovered signer for sure.
    const sig = payload.payload.signature
    const before = sig.slice(0, 4)
    const flipped = sig[4] === '0' ? '1' : '0'
    const after = sig.slice(5)
    payload.payload.signature = (before + flipped + after) as `0x${string}`

    const db = makeFakeDb()
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    }))
    expect(res.status).toBe(401)
    const body = await res.json() as { invalidReason: string }
    expect(body.invalidReason).toMatch(/INVALID_SIGNATURE|SIGNATURE_RECOVERY_FAILED/)
  })

  it('rejects signature signed for wrong chainId (INVALID_SIGNATURE)', async () => {
    // Sign the EIP-3009 message for mainnet chainId=8453 instead of Base Sepolia 84532.
    // The facilitator is configured for 84532, so signature recovery will produce a
    // different address → INVALID_SIGNATURE.
    const pk = ('0x' + '11'.repeat(32)) as `0x${string}`
    const account = privateKeyToAccount(pk)
    const auth: EIP3009Authorization = {
      from: account.address,
      to:   '0x1111111111111111111111111111111111111111',
      value: '10000',
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 600),
      nonce: ('0x' + '22'.repeat(32)) as `0x${string}`,
    }
    // Sign under chainId=8453 (Base mainnet) — deliberately wrong.
    const wrongChainSig = await account.signTypedData({
      domain: { name: 'USDC', version: '2', chainId: 8453, verifyingContract: USDC },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: auth.from as `0x${string}`,
        to:   auth.to as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
    })
    const requirements: PaymentRequirements = {
      scheme: 'exact', network: NETWORK, amount: '10000', asset: USDC,
      payTo: auth.to, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' },
    }
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: { signature: wrongChainSig, authorization: auth },
    }
    const db = makeFakeDb()
    const res = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    }))
    expect(res.status).toBe(401)
    const body = await res.json() as { invalidReason: string }
    expect(body.invalidReason).toMatch(/INVALID_SIGNATURE|SIGNATURE_RECOVERY_FAILED/)
    // No receipt row must be inserted for an invalid signature.
    expect(db.rows.size).toBe(0)
  })

  it('DEADLINE_TOO_TIGHT boundary: now+29s rejected, now+30s passes guard', async () => {
    // The guard in verify.ts is: `validBefore - nowSec < 30` (strict less-than).
    // At exactly 29s remaining → 29 < 30 → DEADLINE_TOO_TIGHT (400).
    // At exactly 30s remaining → 30 < 30 → false → passes the deadline guard.
    const { payload, requirements } = await makeValidPayload()
    const db = makeFakeDb()
    const nowSec = Math.floor(Date.now() / 1000)

    // 29s from now → rejected.
    const tightPayload = structuredClone(payload)
    tightPayload.payload.authorization.validBefore = String(nowSec + 29)
    const tightRes = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: tightPayload, paymentRequirements: requirements }),
    }))
    expect(tightRes.status).toBe(400)
    expect(((await tightRes.json()) as { invalidReason: string }).invalidReason).toBe('DEADLINE_TOO_TIGHT')

    // 30s from now → passes the deadline guard (30 < 30 is false).
    // The signature was originally made with validBefore=now+600, so after we overwrite
    // validBefore in the payload the sig no longer matches → 401. That's fine here:
    // we only need to confirm the response is NOT a 400 DEADLINE_TOO_TIGHT.
    const okPayload = structuredClone(payload)
    okPayload.payload.authorization.validBefore = String(nowSec + 30)
    const okRes = await makeApp(makeEnv(db)).fetch(new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: okPayload, paymentRequirements: requirements }),
    }))
    // Must NOT be 400 DEADLINE_TOO_TIGHT — any other status is acceptable.
    if (okRes.status === 400) {
      const body = await okRes.json() as { invalidReason: string }
      expect(body.invalidReason).not.toBe('DEADLINE_TOO_TIGHT')
    }
  })

  it('inserts a SUBMITTED row on first call and is idempotent on replay', async () => {
    const { payload, requirements, buyer } = await makeValidPayload()
    const db = makeFakeDb()
    const app = makeApp(makeEnv(db))
    const makeReq = () => new Request('https://f.local/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    })

    const first = await app.fetch(makeReq())
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { isValid: boolean; payer: string; paymentId: string; state: string }
    expect(firstBody.isValid).toBe(true)
    expect(firstBody.payer.toLowerCase()).toBe(buyer.toLowerCase())
    expect(firstBody.state).toBe('SUBMITTED')
    expect(firstBody.paymentId).toMatch(/^0x[0-9a-f]{64}$/)
    expect(db.rows.size).toBe(1)

    // Replay — must NOT create a second row.
    const second = await app.fetch(makeReq())
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { paymentId: string; state: string }
    expect(secondBody.paymentId).toBe(firstBody.paymentId)
    expect(db.rows.size).toBe(1)
  })
})
