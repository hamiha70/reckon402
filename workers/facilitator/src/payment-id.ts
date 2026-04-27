import { keccak256, encodePacked } from 'viem'
import type { EIP3009Authorization } from '@reckon402/types'

/**
 * Deterministic paymentId.
 * Formula: keccak256(abi.encodePacked(from, to, value, validAfter, validBefore, nonce))
 * — byte-identical to L2's workers/agent/src/payment-id.ts and
 * @reckon402/buyer-sdk's derivePaymentId (shared helper, lifted in commit 4).
 *
 * At L3 commit 3 this helper is inlined locally. Commit 4 replaces the body
 * with `export { computePaymentId } from '@reckon402/buyer-sdk'` once the
 * buyer-sdk package lands; the function contract is unchanged.
 */
export function computePaymentId(auth: EIP3009Authorization): `0x${string}` {
  return keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
      [
        auth.from as `0x${string}`,
        auth.to as `0x${string}`,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce as `0x${string}`,
      ],
    ),
  )
}
