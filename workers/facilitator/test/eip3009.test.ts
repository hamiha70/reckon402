import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverEip3009Signer, splitSignature, caip2ToChainId } from '../src/eip3009.js'

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

describe('splitSignature', () => {
  it('splits a 65-byte flat signature into (r, s, v)', () => {
    const sig =
      ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1c') as `0x${string}`
    const { r, s, v } = splitSignature(sig)
    expect(r).toBe('0x' + 'aa'.repeat(32))
    expect(s).toBe('0x' + 'bb'.repeat(32))
    expect(v).toBe(28)
  })

  it('handles v=27 (legacy Ethereum recovery id 0)', () => {
    // Some wallets emit v=27 instead of v=28. splitSignature must pass it
    // through unchanged so USDC.transferWithAuthorization gets the right value.
    const sig =
      ('0x' + 'cc'.repeat(32) + 'dd'.repeat(32) + '1b') as `0x${string}`
    const { r, s, v } = splitSignature(sig)
    expect(r).toBe('0x' + 'cc'.repeat(32))
    expect(s).toBe('0x' + 'dd'.repeat(32))
    expect(v).toBe(27)
  })

  it('rejects wrong-length input', () => {
    expect(() => splitSignature('0xabcd' as `0x${string}`)).toThrow(/65-byte/)
  })
})

describe('caip2ToChainId', () => {
  it('parses eip155 CAIP-2 strings', () => {
    expect(caip2ToChainId('eip155:84532')).toBe(84532)
    expect(caip2ToChainId('eip155:8453')).toBe(8453)
  })
  it('rejects non-eip155 CAIP-2', () => {
    expect(() => caip2ToChainId('solana:mainnet')).toThrow(/unsupported CAIP-2/)
  })
})

describe('recoverEip3009Signer', () => {
  it('recovers the signer from a valid EIP-3009 TransferWithAuthorization', async () => {
    // Deterministic test PK (NOT a real key).
    const pk = ('0x' + '11'.repeat(32)) as `0x${string}`
    const account = privateKeyToAccount(pk)

    const authorization = {
      from: account.address,
      to:   '0xD53ffac42496d73B3Faf946786688a8454F57b1f',
      value: '10000',
      validAfter: '0',
      validBefore: '1999999999',
      nonce: ('0x' + '22'.repeat(32)) as `0x${string}`,
    }

    const signature = await account.signTypedData({
      domain: {
        name: 'USDC',
        version: '2',
        chainId: 84532,
        verifyingContract: USDC_BASE_SEPOLIA,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        authorization.from,
        to:          authorization.to as `0x${string}`,
        value:       BigInt(authorization.value),
        validAfter:  BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce:       authorization.nonce,
      },
    })

    const recovered = await recoverEip3009Signer({
      authorization,
      signature,
      chainId: 84532,
      usdcAddress: USDC_BASE_SEPOLIA,
    })

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
