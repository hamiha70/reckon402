import { recoverTypedDataAddress } from 'viem'
import type { EIP3009Authorization } from '@reckon402/types'

/**
 * EIP-3009 TransferWithAuthorization signature validation against USDC's
 * EIP-712 domain on a given network. Returns the recovered signer address,
 * or throws if recovery fails.
 *
 * L3 validates the ECDSA path only. EIP-1271 / SCA support is X36 forward-
 * compat (design pack 02_facilitator.md §4.1 step 5 — "may stop after step 4").
 */
export async function recoverEip3009Signer(args: {
  authorization: EIP3009Authorization
  signature: `0x${string}`
  chainId: number
  usdcAddress: `0x${string}`
}): Promise<`0x${string}`> {
  const { authorization, signature, chainId, usdcAddress } = args

  const domain = {
    name: 'USDC',
    version: '2',
    chainId,
    verifyingContract: usdcAddress,
  } as const

  const types = {
    TransferWithAuthorization: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
    ],
  } as const

  const message = {
    from:        authorization.from as `0x${string}`,
    to:          authorization.to as `0x${string}`,
    value:       BigInt(authorization.value),
    validAfter:  BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce:       authorization.nonce as `0x${string}`,
  }

  return await recoverTypedDataAddress({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
    signature,
  })
}

/**
 * Split a flat 65-byte ECDSA signature into (v, r, s) for the
 * USDC.transferWithAuthorization signature: `0x{r(32)}{s(32)}{v(1)}`.
 */
export function splitSignature(sig: `0x${string}`): {
  v: number
  r: `0x${string}`
  s: `0x${string}`
} {
  if (sig.length !== 132) {
    throw new Error(`expected 65-byte hex signature (132 chars including 0x), got ${sig.length}`)
  }
  const r = `0x${sig.slice(2, 66)}` as `0x${string}`
  const s = `0x${sig.slice(66, 130)}` as `0x${string}`
  const v = Number.parseInt(sig.slice(130, 132), 16)
  return { v, r, s }
}

/** CAIP-2 "eip155:NNN" → numeric chainId. */
export function caip2ToChainId(caip2: string): number {
  const m = /^eip155:(\d+)$/.exec(caip2)
  if (!m) throw new Error(`unsupported CAIP-2: ${caip2}`)
  return Number.parseInt(m[1], 10)
}
