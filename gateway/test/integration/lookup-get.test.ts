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
      'x402.splitter': '0x0ad507c6973eba86313794329ad9b12fbf24acd0',
    },
  },
]

describe('GET /lookup/:sender/:data — happy path', () => {
  test('returns 200 with data field', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.splitter')
    const path = `/lookup/${RESOLVER}/${callData}`

    const res = await app.request('GET', path)
    expect(res.status).toBe(200)

    const body = await res.json() as { data: Hex }
    expect(body.data).toMatch(/^0x/)
  })

  test('result bytes decode to splitter address', async () => {
    const env = makeEnv(TEST_MERCHANTS)
    const app = makeApp(env)

    const callData = buildCallData('seller.reckon402-test.eth', CALLER, 'x402.splitter')
    const path = `/lookup/${RESOLVER}/${callData}`

    const res = await app.request('GET', path)
    const body = await res.json() as { data: Hex }

    const [resultBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }],
      body.data,
    )

    const [splitter] = decodeAbiParameters([{ type: 'string' }], resultBytes as Hex)
    expect(splitter.toLowerCase()).toBe('0x0ad507c6973eba86313794329ad9b12fbf24acd0')
  })
})
