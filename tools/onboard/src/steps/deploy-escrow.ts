import {
  createPublicClient, createWalletClient, http, keccak256, toBytes,
  type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

/// EscrowFactory ABI subset — predict + deploy + isDeployed checks. Shape
/// must match `contracts/src/EscrowFactory.sol` post-pluggable refactor.
export const ESCROW_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createEscrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId',           type: 'uint256' },
      { name: 'facilitatorClient', type: 'address' },
      { name: 'tierStrategy',      type: 'address' },
      { name: 'tag1',              type: 'string'  },
      { name: 'tag2',              type: 'string'  },
      { name: 'salt',              type: 'bytes32' },
    ],
    outputs: [{ name: 'escrow', type: 'address' }],
  },
  {
    type: 'function',
    name: 'predictAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId',           type: 'uint256' },
      { name: 'facilitatorClient', type: 'address' },
      { name: 'tierStrategy',      type: 'address' },
      { name: 'tag1',              type: 'string'  },
      { name: 'tag2',              type: 'string'  },
      { name: 'salt',              type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isDeployed',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'escrowOfAgent',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/// Salt convention for L4d Escrow deploys: keccak256(`ensName`).
/// Matches the convention used by `saltFromEnsName` in deploy-splitter.ts.
/// Each agent's Escrow lands at a deterministic address derivable from
/// the public ENS subname.
export function escrowSaltFromEnsName(ensName: string): Hex {
  return keccak256(toBytes(ensName))
}

export interface DeployEscrowArgs {
  factoryAddress:    `0x${string}`
  ensName:           string
  agentId:           bigint
  facilitatorClient: `0x${string}`
  tierStrategy:      `0x${string}`
  tag1:              string  // "payment"
  tag2:              string  // "x402-settlement"
}

export interface DeployEscrowResult {
  escrow:           `0x${string}`
  escrowDeployTx:   Hex | null   // null if already deployed (idempotent re-run)
  salt:             Hex
  externalLink:     string
}

export interface DeployEscrowClients {
  public: PublicClient
  wallet: WalletClient
}

export function makeDeployEscrowClients(
  rpcUrl: string,
  deployerPk: `0x${string}`,
): DeployEscrowClients {
  const account = privateKeyToAccount(deployerPk)
  return {
    public: createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 60_000 }) }) as PublicClient,
    wallet: createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl, { timeout: 60_000 }) }),
  }
}

/// Predict the Escrow address WITHOUT broadcasting. Cheap eth_call so the
/// orchestrator can wire the predicted address into the Splitter's
/// `recipients[2]` slot in advance of the Escrow's actual deploy.
export async function predictEscrowAddress(
  clients: DeployEscrowClients,
  args: DeployEscrowArgs,
): Promise<{ escrow: `0x${string}`; salt: Hex }> {
  const salt = escrowSaltFromEnsName(args.ensName)

  const escrow = await clients.public.readContract({
    address:      args.factoryAddress,
    abi:          ESCROW_FACTORY_ABI,
    functionName: 'predictAddress',
    args: [
      args.agentId,
      args.facilitatorClient,
      args.tierStrategy,
      args.tag1,
      args.tag2,
      salt,
    ],
  }) as `0x${string}`

  return { escrow, salt }
}

/// Step — deploy the SellingAgent's Escrow via EscrowFactory on Base Sepolia.
///
/// Idempotent: if `escrowOfAgent[agentId]` is already non-zero, we skip
/// the deploy and return the existing address with `escrowDeployTx = null`.
export async function deployEscrow(
  clients: DeployEscrowClients,
  args: DeployEscrowArgs,
): Promise<DeployEscrowResult> {
  const salt = escrowSaltFromEnsName(args.ensName)

  // Idempotency check 1: does the factory already record an escrow for
  // this agentId? (one-Escrow-per-agent invariant on the contract.)
  const existing = await clients.public.readContract({
    address:      args.factoryAddress,
    abi:          ESCROW_FACTORY_ABI,
    functionName: 'escrowOfAgent',
    args:         [args.agentId],
  }) as `0x${string}`

  if (existing !== '0x0000000000000000000000000000000000000000') {
    return {
      escrow:         existing,
      escrowDeployTx: null,
      salt,
      externalLink:   `https://sepolia.basescan.org/address/${existing}`,
    }
  }

  // Idempotency check 2: predict the address and see if it already has code
  // (covers the case where the same predict tuple was deployed under a
  // different agentId path — should not happen in practice, but defensive).
  const predicted = await clients.public.readContract({
    address:      args.factoryAddress,
    abi:          ESCROW_FACTORY_ABI,
    functionName: 'predictAddress',
    args: [
      args.agentId,
      args.facilitatorClient,
      args.tierStrategy,
      args.tag1,
      args.tag2,
      salt,
    ],
  }) as `0x${string}`

  const alreadyDeployed = await clients.public.readContract({
    address:      args.factoryAddress,
    abi:          ESCROW_FACTORY_ABI,
    functionName: 'isDeployed',
    args:         [predicted],
  }) as boolean

  if (alreadyDeployed) {
    return {
      escrow:         predicted,
      escrowDeployTx: null,
      salt,
      externalLink:   `https://sepolia.basescan.org/address/${predicted}`,
    }
  }

  const tx = await clients.wallet.writeContract({
    address:      args.factoryAddress,
    abi:          ESCROW_FACTORY_ABI,
    functionName: 'createEscrow',
    args: [
      args.agentId,
      args.facilitatorClient,
      args.tierStrategy,
      args.tag1,
      args.tag2,
      salt,
    ],
    account: clients.wallet.account!,
    chain:   baseSepolia,
  })
  await clients.public.waitForTransactionReceipt({ hash: tx })

  return {
    escrow:         predicted,
    escrowDeployTx: tx,
    salt,
    externalLink:   `https://sepolia.basescan.org/tx/${tx}`,
  }
}
