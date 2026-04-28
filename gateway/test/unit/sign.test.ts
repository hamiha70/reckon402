import { describe, test, expect } from 'vitest'
import { decodeAbiParameters, keccak256, encodeAbiParameters, concat, toBytes, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signCcipResponse } from '../../src/ccip/sign.js'
import { encodeTextResult } from '../../src/ccip/encode.js'

const TEST_PK = '0x' + 'ab'.repeat(32) as Hex

describe('signCcipResponse', () => {
  test('returns ABI-decodable (bytes, uint64, bytes32, bytes) tuple', async () => {
    const result = encodeTextResult('https://facilitator.reckon402.com')
    const extraData = encodeAbiParameters([{ type: 'bytes' }], [result])

    const response = await signCcipResponse(result, extraData, TEST_PK)

    const [decodedResult, timestamp, nonce, sig] = decodeAbiParameters(
      [
        { name: 'result',    type: 'bytes'   },
        { name: 'timestamp', type: 'uint64'  },
        { name: 'nonce',     type: 'bytes32' },
        { name: 'sig',       type: 'bytes'   },
      ],
      response,
    )

    expect(decodedResult).toBe(result)
    expect(typeof timestamp).toBe('bigint')
    expect(timestamp).toBeGreaterThan(0n)
    expect(nonce).toHaveLength(66)  // 0x + 64 hex chars
    expect(sig).toHaveLength(132)   // 0x + 130 hex chars (65 bytes)
  })

  test('signature recovers to the signer address', async () => {
    const result = encodeTextResult('0x0ad507c6973eba86313794329ad9b12fbf24acd0')
    const extraData = encodeAbiParameters([{ type: 'bytes' }], [result])

    const response = await signCcipResponse(result, extraData, TEST_PK)

    const [decodedResult, timestamp, nonce, sig] = decodeAbiParameters(
      [
        { name: 'result',    type: 'bytes'   },
        { name: 'timestamp', type: 'uint64'  },
        { name: 'nonce',     type: 'bytes32' },
        { name: 'sig',       type: 'bytes'   },
      ],
      response,
    )

    // Recompute digest
    const digest = keccak256(
      encodeAbiParameters(
        [
          { name: 'result',    type: 'bytes'   },
          { name: 'timestamp', type: 'uint64'  },
          { name: 'nonce',     type: 'bytes32' },
          { name: 'extraData', type: 'bytes'   },
        ],
        [decodedResult as Hex, timestamp as bigint, nonce as Hex, extraData],
      ),
    )
    const ethDigest = keccak256(
      concat([toBytes('\x19Ethereum Signed Message:\n32'), toBytes(digest)])
    )

    // Recover signer from signature
    const { recoverAddress } = await import('viem')
    const recovered = await recoverAddress({ hash: ethDigest, signature: sig as Hex })
    const expected = privateKeyToAccount(TEST_PK).address

    expect(recovered.toLowerCase()).toBe(expected.toLowerCase())
  })

  test('two calls produce different nonces', async () => {
    const result = encodeTextResult('value')
    const extraData = encodeAbiParameters([{ type: 'bytes' }], [result])

    const r1 = await signCcipResponse(result, extraData, TEST_PK)
    const r2 = await signCcipResponse(result, extraData, TEST_PK)

    const [, , nonce1] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }],
      r1,
    )
    const [, , nonce2] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }],
      r2,
    )
    // Extremely unlikely to collide; this is a sanity check
    expect(nonce1).not.toBe(nonce2)
  })
})
