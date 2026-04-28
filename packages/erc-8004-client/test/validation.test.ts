import { describe, it, expect } from 'vitest'
import type { PublicClient } from 'viem'
import { validation, requireValidationAddress } from '../src/index.js'

describe('validation — not deployed at pinned commit', () => {
  it('requireValidationAddress throws on Base Sepolia', () => {
    expect(() => requireValidationAddress(84532)).toThrow(/VALIDATION_NOT_DEPLOYED/)
  })

  it('getValidationStatus throws VALIDATION_NOT_DEPLOYED on Base Sepolia', async () => {
    const pc = {} as unknown as PublicClient
    await expect(
      validation.getValidationStatus({ chainId: 84532, publicClient: pc, requestHash: '0x00' as any }),
    ).rejects.toThrow(/VALIDATION_NOT_DEPLOYED/)
  })

  it('getAgentValidations throws VALIDATION_NOT_DEPLOYED on Base Mainnet', async () => {
    const pc = {} as unknown as PublicClient
    await expect(
      validation.getAgentValidations({ chainId: 8453, publicClient: pc, agentId: 1n }),
    ).rejects.toThrow(/VALIDATION_NOT_DEPLOYED/)
  })

  it('getValidatorRequests throws VALIDATION_NOT_DEPLOYED on ETH Sepolia', async () => {
    const pc = {} as unknown as PublicClient
    await expect(
      validation.getValidatorRequests({
        chainId: 11155111,
        publicClient: pc,
        validatorAddress: '0x0000000000000000000000000000000000000000',
      }),
    ).rejects.toThrow(/VALIDATION_NOT_DEPLOYED/)
  })

  it('getSummary throws VALIDATION_NOT_DEPLOYED on ETH Mainnet', async () => {
    const pc = {} as unknown as PublicClient
    await expect(
      validation.getSummary({ chainId: 1, publicClient: pc, agentId: 1n, validatorAddresses: [], tag: '' }),
    ).rejects.toThrow(/VALIDATION_NOT_DEPLOYED/)
  })
})
