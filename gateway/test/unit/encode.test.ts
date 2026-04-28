import { describe, test, expect } from 'vitest'
import { decodeAbiParameters, type Hex } from 'viem'
import { encodeTextResult, encodeCcipResponse } from '../../src/ccip/encode.js'

describe('encodeTextResult', () => {
  test('encodes string as ABI (string) type', () => {
    const result = encodeTextResult('https://facilitator.reckon402.com')
    const [decoded] = decodeAbiParameters([{ type: 'string' }], result)
    expect(decoded).toBe('https://facilitator.reckon402.com')
  })

  test('encodes empty string', () => {
    const result = encodeTextResult('')
    const [decoded] = decodeAbiParameters([{ type: 'string' }], result)
    expect(decoded).toBe('')
  })

  test('encoded value starts with 0x', () => {
    expect(encodeTextResult('test')).toMatch(/^0x/)
  })
})

describe('encodeCcipResponse', () => {
  test('round-trips all fields', () => {
    const result    = '0x1234' as Hex
    const timestamp = 1714300000n
    const nonce     = ('0x' + 'aa'.repeat(32)) as Hex
    const sig       = ('0x' + 'bb'.repeat(65)) as Hex

    const encoded = encodeCcipResponse(result, timestamp, nonce, sig)

    const [r, t, n, s] = decodeAbiParameters(
      [
        { type: 'bytes'   },
        { type: 'uint64'  },
        { type: 'bytes32' },
        { type: 'bytes'   },
      ],
      encoded,
    )

    expect(r).toBe(result)
    expect(t).toBe(timestamp)
    expect(n).toBe(nonce)
    expect(s).toBe(sig)
  })
})
