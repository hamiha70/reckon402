import { describe, test, expect } from 'vitest'
import { encodeAbiParameters, type Hex } from 'viem'
import { decodeCallData, dnsDecodeName, decodeTextKey } from '../../src/ccip/decode.js'
import { GatewayError } from '../../src/lib/errors.js'

// ─── Helpers to build fixture callData ──────────────────────────────────────

function buildCallData(name: Hex, callerAddr: `0x${string}`, innerData: Hex): Hex {
  return encodeAbiParameters(
    [
      { name: 'name',       type: 'bytes'   },
      { name: 'callerAddr', type: 'address' },
      { name: 'innerData',  type: 'bytes'   },
    ],
    [name, callerAddr, innerData],
  )
}

// DNS wire-encode "seller.reckon402-test.eth"
function dnsEncode(name: string): Hex {
  const labels = name.split('.')
  const parts: number[] = []
  for (const label of labels) {
    parts.push(label.length)
    for (const ch of label) parts.push(ch.charCodeAt(0))
  }
  parts.push(0)  // terminating null
  return ('0x' + parts.map(b => b.toString(16).padStart(2, '0')).join('')) as Hex
}

// Build innerData for text(bytes32 node, string key)
function buildTextCallData(node: Hex, key: string): Hex {
  const selector = '0x59d1d43c'  // bytes4(keccak256("text(bytes32,string)"))
  const encoded = encodeAbiParameters(
    [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
    [node, key],
  )
  return (selector + encoded.slice(2)) as Hex
}

// ─── decodeCallData ──────────────────────────────────────────────────────────

describe('decodeCallData', () => {
  test('happy path: decodes name, callerAddr, innerData correctly', () => {
    const encodedName = dnsEncode('seller.reckon402-test.eth')
    const caller = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as `0x${string}`
    const innerData = '0x1234' as Hex
    const callData = buildCallData(encodedName, caller, innerData)

    const decoded = decodeCallData(callData)
    expect(decoded.callerAddr.toLowerCase()).toBe(caller.toLowerCase())
    expect(decoded.innerData).toBe(innerData)
  })

  test('throws MALFORMED_CALL_DATA on garbage input', () => {
    let caught: unknown
    try { decodeCallData('0xdeadbeef') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(GatewayError)
    expect((caught as GatewayError).code).toBe('MALFORMED_CALL_DATA')
  })

  test('throws MALFORMED_CALL_DATA on empty hex', () => {
    let caught: unknown
    try { decodeCallData('0x') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(GatewayError)
    expect((caught as GatewayError).code).toBe('MALFORMED_CALL_DATA')
  })
})

// ─── dnsDecodeName ───────────────────────────────────────────────────────────

describe('dnsDecodeName', () => {
  test('decodes single-label name', () => {
    expect(dnsDecodeName(dnsEncode('eth'))).toBe('eth')
  })

  test('decodes multi-label name', () => {
    expect(dnsDecodeName(dnsEncode('seller.reckon402-test.eth'))).toBe('seller.reckon402-test.eth')
  })

  test('decodes 3-label name', () => {
    expect(dnsDecodeName(dnsEncode('a.b.c'))).toBe('a.b.c')
  })
})

// ─── decodeTextKey ───────────────────────────────────────────────────────────

describe('decodeTextKey', () => {
  test('decodes x402.pricing key', () => {
    const node = '0x' + '00'.repeat(32) as Hex
    const inner = buildTextCallData(node, 'x402.pricing')
    expect(decodeTextKey(inner)).toBe('x402.pricing')
  })

  test('decodes x402.facilitator key', () => {
    const node = '0x' + 'aa'.repeat(32) as Hex
    const inner = buildTextCallData(node, 'x402.facilitator')
    expect(decodeTextKey(inner)).toBe('x402.facilitator')
  })

  test('throws MALFORMED_CALL_DATA on too-short innerData', () => {
    expect(() => decodeTextKey('0x1234')).toThrowError(GatewayError)
  })
})
