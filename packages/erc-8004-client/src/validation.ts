import type { Address, PublicClient, WalletClient, Hex } from 'viem'
import { VALIDATION_ABI } from './abis/validation.js'
import { requireValidationAddress } from './multichain.js'
import type { ValidationStatus } from './types.js'

/**
 * ValidationRegistry is not deployed at the pinned upstream commit.
 * Every function here throws VALIDATION_NOT_DEPLOYED (via
 * requireValidationAddress) until upstream ships a real deployment.
 * The ABI + shape are kept so L4b can wire writes the moment upstream
 * deploys without a breaking library bump.
 */
export const validation = {
  async getValidationStatus(args: {
    chainId: number
    publicClient: PublicClient
    requestHash: Hex
  }): Promise<ValidationStatus> {
    const contract = requireValidationAddress(args.chainId)
    const out = (await args.publicClient.readContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'getValidationStatus',
      args: [args.requestHash],
    })) as readonly [Address, bigint, number, Hex, string, bigint]
    return {
      validator: out[0],
      agentId: out[1],
      response: out[2],
      responseHash: out[3],
      tag: out[4],
      lastUpdate: out[5],
    }
  },

  async getAgentValidations(args: {
    chainId: number
    publicClient: PublicClient
    agentId: bigint
  }): Promise<Hex[]> {
    const contract = requireValidationAddress(args.chainId)
    return args.publicClient.readContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'getAgentValidations',
      args: [args.agentId],
    }) as Promise<Hex[]>
  },

  async getValidatorRequests(args: {
    chainId: number
    publicClient: PublicClient
    validatorAddress: Address
  }): Promise<Hex[]> {
    const contract = requireValidationAddress(args.chainId)
    return args.publicClient.readContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'getValidatorRequests',
      args: [args.validatorAddress],
    }) as Promise<Hex[]>
  },

  async getSummary(args: {
    chainId: number
    publicClient: PublicClient
    agentId: bigint
    validatorAddresses: Address[]
    tag: string
  }): Promise<{ count: bigint; avgResponse: number }> {
    const contract = requireValidationAddress(args.chainId)
    const out = (await args.publicClient.readContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'getSummary',
      args: [args.agentId, args.validatorAddresses, args.tag],
    })) as readonly [bigint, number]
    return { count: out[0], avgResponse: out[1] }
  },

  // --- writes ---

  async validationRequest(args: {
    chainId: number
    walletClient: WalletClient
    validatorAddress: Address
    agentId: bigint
    requestURI: string
    requestHash: Hex
  }): Promise<Hex> {
    const contract = requireValidationAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'validationRequest',
      args: [args.validatorAddress, args.agentId, args.requestURI, args.requestHash],
      account,
      chain: null,
    })
  },

  async validationResponse(args: {
    chainId: number
    walletClient: WalletClient
    requestHash: Hex
    response: number
    responseURI: string
    responseHash: Hex
    tag: string
  }): Promise<Hex> {
    const contract = requireValidationAddress(args.chainId)
    const account = args.walletClient.account
    if (!account) throw new Error('WALLET_CLIENT_ACCOUNT_MISSING')
    return args.walletClient.writeContract({
      address: contract,
      abi: VALIDATION_ABI,
      functionName: 'validationResponse',
      args: [args.requestHash, args.response, args.responseURI, args.responseHash, args.tag],
      account,
      chain: null,
    })
  },
}
