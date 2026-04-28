import { decodeAbiParameters, type Address, type Hex } from 'viem'
import { GatewayError } from '../lib/errors.js'

export interface DecodedCallData {
  name: Hex           // DNS-encoded ENS name (bytes)
  callerAddr: Address // the original EOA (Pattern A)
  innerData: Hex      // the resolver function calldata (e.g. text(bytes32,string))
}

/**
 * Decode the ABI-encoded callData produced by Reckon402Resolver.resolve().
 * Shape: abi.encode(bytes name, address callerAddr, bytes innerData)
 */
export function decodeCallData(data: Hex): DecodedCallData {
  try {
    const [name, callerAddr, innerData] = decodeAbiParameters(
      [
        { name: 'name',       type: 'bytes'   },
        { name: 'callerAddr', type: 'address' },
        { name: 'innerData',  type: 'bytes'   },
      ],
      data,
    )
    return {
      name:       name as Hex,
      callerAddr: callerAddr as Address,
      innerData:  innerData as Hex,
    }
  } catch {
    throw new GatewayError('MALFORMED_CALL_DATA', `Failed to ABI-decode callData: ${data.slice(0, 20)}…`)
  }
}

/**
 * Decode the ENS name bytes (DNS wire format) into a dot-separated string.
 * DNS wire format: each label is prefixed by its length byte, terminated by 0x00.
 */
export function dnsDecodeName(encoded: Hex): string {
  const bytes = hexToBytes(encoded)
  const labels: string[] = []
  let i = 0
  while (i < bytes.length) {
    const len = bytes[i]
    if (len === 0) break
    labels.push(new TextDecoder().decode(bytes.slice(i + 1, i + 1 + len)))
    i += 1 + len
  }
  return labels.join('.')
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Extract the text-record key from innerData.
 * innerData is the ABI-encoded call to text(bytes32 node, string key).
 * Selector: keccak256("text(bytes32,string)")[0:4] = 0x59d1d43c
 */
export function decodeTextKey(innerData: Hex): string {
  // Skip 4-byte selector + 32-byte node → remaining bytes decode as (string key)
  if (innerData.length < 10) throw new GatewayError('MALFORMED_CALL_DATA', 'innerData too short')
  const withoutSelector = ('0x' + innerData.slice(10)) as Hex
  try {
    const [, key] = decodeAbiParameters(
      [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
      withoutSelector,
    )
    return key as string
  } catch {
    throw new GatewayError('MALFORMED_CALL_DATA', 'Could not decode text(bytes32,string) args')
  }
}
