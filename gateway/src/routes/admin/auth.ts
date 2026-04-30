import {
  keccak256,
  encodeAbiParameters,
  recoverAddress,
  getAddress,
  isAddress,
  type Hex,
} from 'viem'

// Chain ID encoded into the digest. We bind signed-writes to Ethereum Sepolia
// because that is where ENS ownership lives (owner(node) is resolved on
// Sepolia). Using Sepolia's chainId prevents a mainnet signature from being
// replayed against a Sepolia-only gateway and vice versa.
export const SIGNED_WRITE_CHAIN_ID = 11_155_111n // Ethereum Sepolia

export interface SignedWritePayload {
  ensName: string
  key: string
  value: string
  nonce: Hex
  signature: Hex
}

/**
 * Digest canonicalization per spec 08B §4.1:
 *   digest = keccak256(abi.encode(chainId, ensName, key, value, nonce))
 *
 * `chainId` is uint256, `ensName/key/value` are `string`, `nonce` is `bytes32`.
 * Callers MUST sign `digest` directly (not an EIP-191 wrap) so that the
 * verification side is also a raw recover. This is intentionally simple —
 * we do not need user-facing wallet display, only programmatic SDK signing.
 */
export function buildSignedWriteDigest(params: {
  ensName: string
  key: string
  value: string
  nonce: Hex
}): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: 'chainId', type: 'uint256' },
      { name: 'ensName', type: 'string' },
      { name: 'key',     type: 'string' },
      { name: 'value',   type: 'string' },
      { name: 'nonce',   type: 'bytes32' },
    ],
    [SIGNED_WRITE_CHAIN_ID, params.ensName, params.key, params.value, params.nonce],
  )
  return keccak256(encoded)
}

/**
 * Recover the signer from a signed-write payload. Returns null on any
 * malformed input (bad nonce shape, bad signature shape, bad hex).
 */
export async function recoverSignedWriteSigner(
  payload: SignedWritePayload,
): Promise<`0x${string}` | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(payload.nonce)) return null
  // EIP-2098 short sig is 64 bytes; classic RSV is 65 bytes.
  if (!/^0x[0-9a-fA-F]{128,130}$/.test(payload.signature)) return null

  const digest = buildSignedWriteDigest({
    ensName: payload.ensName,
    key:     payload.key,
    value:   payload.value,
    nonce:   payload.nonce,
  })
  try {
    const recovered = await recoverAddress({ hash: digest, signature: payload.signature })
    if (!isAddress(recovered)) return null
    return getAddress(recovered) as `0x${string}`
  } catch {
    return null
  }
}

/**
 * Compare two addresses case-insensitively. Never compare raw strings — the
 * caller may have a mix of checksum / lowercased / uppercased inputs and
 * `===` silently returns false.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return false
  }
}
