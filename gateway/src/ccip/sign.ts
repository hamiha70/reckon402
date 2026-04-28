import {
  keccak256,
  concat,
  toBytes,
  toHex,
  encodeAbiParameters,
  type Hex,
  type Account,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { encodeCcipResponse } from './encode.js'

/**
 * Sign a CCIP-Read response per the Reckon402Resolver callback schema:
 *
 *   digest    = keccak256(abi.encode(result, timestamp, nonce, extraData))
 *   ethDigest = keccak256("\x19Ethereum Signed Message:\n32" || digest)
 *   sig       = sign(ethDigest, signerPk)
 *   response  = abi.encode(result, timestamp, nonce, sig)
 *
 * This schema must match resolveCallback() in Reckon402Resolver.sol exactly.
 */
export async function signCcipResponse(
  result: Hex,
  extraData: Hex,
  signerPk: Hex,
): Promise<Hex> {
  const timestamp = BigInt(Math.floor(Date.now() / 1000))
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = toHex(nonceBytes) as Hex

  const digest = keccak256(
    encodeAbiParameters(
      [
        { name: 'result',    type: 'bytes'   },
        { name: 'timestamp', type: 'uint64'  },
        { name: 'nonce',     type: 'bytes32' },
        { name: 'extraData', type: 'bytes'   },
      ],
      [result, timestamp, nonce, extraData],
    ),
  )

  const ethPrefix = toBytes('\x19Ethereum Signed Message:\n32')
  const ethDigest = keccak256(concat([ethPrefix, toBytes(digest)]))

  const account: Account = privateKeyToAccount(signerPk)
  const sig = await account.sign({ hash: ethDigest })

  return encodeCcipResponse(result, timestamp, nonce, sig)
}
