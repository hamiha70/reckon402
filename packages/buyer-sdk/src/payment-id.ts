import { keccak256, encodePacked } from 'viem'
import type { EIP3009Authorization } from '@reckon402/types'

/**
 * Deterministic paymentId for an EIP-3009 authorization.
 *
 * Formula (LOCKED — any change silently breaks replay protection):
 *   keccak256(abi.encodePacked(address from, address to, uint256 value,
 *                              uint256 validAfter, uint256 validBefore,
 *                              bytes32 nonce))
 *
 * This helper is THE single source of truth across the whole stack. Both
 * the buyer-sdk and the facilitator worker import it from here so they
 * cannot diverge — no byte-equality cross-impl test is needed.
 *
 * Replayability: same inputs → same output. A deliberate replay of the
 * same authorization computes the same paymentId; the facilitator's
 * D1 PRIMARY KEY + INSERT OR IGNORE then short-circuits the second
 * settle attempt. Flip any input field → different paymentId → fresh
 * settle path.
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
