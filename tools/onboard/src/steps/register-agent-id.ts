import {
  createPublicClient, createWalletClient, http, decodeEventLog,
  type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { IDENTITY_REGISTRY_BASE_SEPOLIA } from '../types.js'

// Minimal IdentityRegistry ABI — register(agentURI), ownerOf, Transfer (ERC-721),
// safeTransferFrom. We could import from @reckon402/erc-8004-client but the
// onboarding CLI should stay self-contained for easier packaging.
export const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from',    type: 'address' },
      { name: 'to',      type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from',    type: 'address', indexed: true },
      { name: 'to',      type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export interface RegisterAgentIdArgs {
  identityRegistry: `0x${string}`
  tokenURI:         string
  deployerEoa:      `0x${string}`  // who `register()` is called from (msg.sender → initial owner)
  sellerEoa:        `0x${string}`  // final owner after safeTransferFrom
}

export interface RegisterAgentIdResult {
  agentId:          bigint
  agentRegisterTx:  Hex
  agentTransferTx:  Hex | null     // null if deployerEoa === sellerEoa
  externalLink:     string
}

export interface RegisterAgentIdClients {
  public: PublicClient
  wallet: WalletClient
}

export function makeRegisterAgentIdClients(
  rpcUrl: string,
  deployerPk: `0x${string}`,
): RegisterAgentIdClients {
  const account = privateKeyToAccount(deployerPk)
  return {
    public: createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 15_000 }) }) as PublicClient,
    wallet: createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl, { timeout: 15_000 }) }),
  }
}

/**
 * Step 3 — register an ERC-8004 agentId on Base Sepolia.
 *
 * IdentityRegistry.register(agentURI) → agentId (msg.sender becomes initial owner).
 * Then safeTransferFrom(deployer, seller, agentId) to hand ownership to the
 * SellingAgent EOA.
 *
 * agentId is read from the Transfer event in the register-tx receipt (tokenId).
 */
export async function registerAgentId(
  clients: RegisterAgentIdClients,
  args: RegisterAgentIdArgs,
): Promise<RegisterAgentIdResult> {
  const registerTx = await clients.wallet.writeContract({
    address: args.identityRegistry,
    abi: IDENTITY_ABI,
    functionName: 'register',
    args: [args.tokenURI],
    account:  clients.wallet.account!,
    chain:    baseSepolia,
  })
  const receipt = await clients.public.waitForTransactionReceipt({ hash: registerTx })

  // Decode Transfer(from=0x0, to=deployer, tokenId=agentId) from logs
  let agentId: bigint | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== args.identityRegistry.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: IDENTITY_ABI,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Transfer') {
        // ERC-721 mint: from=0x0
        const from = decoded.args.from
        if (from && from === '0x0000000000000000000000000000000000000000') {
          agentId = decoded.args.tokenId as bigint
          break
        }
      }
    } catch {
      // Not a Transfer event, continue.
    }
  }
  if (agentId === null) {
    throw new Error(`register-agent-id: Transfer event not found in tx ${registerTx}`)
  }

  // Transfer to seller if necessary
  let transferTx: Hex | null = null
  if (args.deployerEoa.toLowerCase() !== args.sellerEoa.toLowerCase()) {
    transferTx = await clients.wallet.writeContract({
      address: args.identityRegistry,
      abi: IDENTITY_ABI,
      functionName: 'safeTransferFrom',
      args: [args.deployerEoa, args.sellerEoa, agentId],
      account:  clients.wallet.account!,
      chain:    baseSepolia,
    })
    await clients.public.waitForTransactionReceipt({ hash: transferTx })
  }

  return {
    agentId,
    agentRegisterTx: registerTx,
    agentTransferTx: transferTx,
    externalLink:    `https://sepolia.basescan.org/tx/${registerTx}`,
  }
}

// Re-export the registry address for orchestrator convenience.
export { IDENTITY_REGISTRY_BASE_SEPOLIA }
