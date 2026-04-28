import { describe, test, expect } from 'vitest'
import { decodeAbiParameters, type Hex } from 'viem'
import { makeEnv, makeApp, buildCallData } from './helpers.js'

const CALLER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as `0x${string}`
const RESOLVER = '0x0000000000000000000000000000000000000002'

const TEST_MERCHANTS = [
  {
    ens_name: 'seller.reckon402-test.eth',
    enabled: 1,
    records: {
      'x402.facilitator': 'https://facilitator.reckon402.com',
      'x402.splitter':    '0x0ad507c6973eba86313794329ad9b12fbf24acd0',
      'x402.pricing':     JSON.stringify({ discount_bps: 0 }),
    },
  },
]

describe('POST /lookup — happy path', () => {
  test('returns 200 with data field for known merchant + key', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.facilitator')

    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    expect(res.status).toBe(200)

    const body = await res.json() as { data: Hex }
    expect(body.data).toBeDefined()
    expect(body.data).toMatch(/^0x/)
  })

  test('response data decodes to (bytes, uint64, bytes32, bytes)', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.facilitator')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    const body = await res.json() as { data: Hex }

    const [result, timestamp, nonce, sig] = decodeAbiParameters(
      [
        { type: 'bytes'   },
        { type: 'uint64'  },
        { type: 'bytes32' },
        { type: 'bytes'   },
      ],
      body.data,
    )

    expect(result).toBeDefined()
    expect(typeof timestamp).toBe('bigint')
    expect(timestamp).toBeGreaterThan(0n)
    expect(nonce).toHaveLength(66)
    expect(sig).toHaveLength(132)
  })

  test('result bytes decode to the expected facilitator URL', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.facilitator')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    const body = await res.json() as { data: Hex }

    const [resultBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }],
      body.data,
    )

    const [decodedValue] = decodeAbiParameters([{ type: 'string' }], resultBytes as Hex)
    expect(decodedValue).toBe('https://facilitator.reckon402.com')
  })

  test('returns 400 UNKNOWN_NAME for missing merchant', async () => {
    const env = makeEnv([])  // no merchants
    const app = makeApp(env)

    const callData = buildCallData('nobody.eth', CALLER, 'x402.facilitator')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    expect(res.status).toBe(400)

    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('UNKNOWN_NAME')
  })

  test('returns 400 MALFORMED_CALL_DATA for garbage data', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: '0xdeadbeef' })
    expect(res.status).toBe(400)

    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('MALFORMED_CALL_DATA')
  })

  test('returns 400 for missing body fields', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const res = await app.request('POST', '/lookup', { sender: RESOLVER })
    expect(res.status).toBe(400)
  })

  test('returns 501 NOT_IMPLEMENTED when ENABLE_ERC8004_READS=true', async () => {
    const env = makeEnv(TEST_MERCHANTS, { ENABLE_ERC8004_READS: 'true' })
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.pricing')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    expect(res.status).toBe(501)
  })
})

describe('POST /lookup — CORS headers', () => {
  test('includes CORS headers on success', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.facilitator')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('includes CORS headers on error', async () => {
    const env = makeEnv([])
    const app = makeApp(env)

    const callData = buildCallData('nobody.eth', CALLER, 'x402.facilitator')
    const res = await app.request('POST', '/lookup', { sender: RESOLVER, data: callData })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
