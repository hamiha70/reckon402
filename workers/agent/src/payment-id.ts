import { keccak256, encodePacked, toBytes } from 'viem'
import type { EIP3009Authorization } from '@reckon402/types'

/**
 * Compute the deterministic paymentId for a given EIP-3009 authorization.
 * Formula: keccak256(abi.encodePacked(eip712TypedData, nonce))
 * per design pack 02_facilitator.md §4.1 step 6.
 *
 * The paymentId is stable across retries (same authorization → same id).
 * CDP won't echo it back; the worker logs it for forward-compat with L3.
 */
export function computePaymentId(authorization: EIP3009Authorization): `0x${string}` {
  const packed = encodePacked(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
    [
      authorization.from as `0x${string}`,
      authorization.to as `0x${string}`,
      BigInt(authorization.value),
      BigInt(authorization.validAfter),
      BigInt(authorization.validBefore),
      authorization.nonce as `0x${string}`,
    ]
  )
  return keccak256(packed)
}
