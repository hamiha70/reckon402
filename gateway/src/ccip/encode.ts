import { encodeAbiParameters, type Hex } from 'viem'

/**
 * ABI-encode a text-record value as the result bytes that the resolver callback
 * returns. The resolver's text() function returns (string), so we ABI-encode
 * as a single string.
 */
export function encodeTextResult(value: string): Hex {
  return encodeAbiParameters([{ name: 'value', type: 'string' }], [value])
}

/**
 * ABI-encode the full signed CCIP-Read response payload:
 *   abi.encode(bytes result, uint64 timestamp, bytes32 nonce, bytes sig)
 *
 * This is what the EIP-3668 client sends back to the resolver's callback.
 */
export function encodeCcipResponse(
  result: Hex,
  timestamp: bigint,
  nonce: Hex,
  sig: Hex,
): Hex {
  return encodeAbiParameters(
    [
      { name: 'result',    type: 'bytes'   },
      { name: 'timestamp', type: 'uint64'  },
      { name: 'nonce',     type: 'bytes32' },
      { name: 'sig',       type: 'bytes'   },
    ],
    [result, timestamp, nonce, sig],
  )
}
