import {
  createPublicClient, createWalletClient, http, keccak256, toBytes,
  type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { nonceManager } from 'viem/nonce'
import { baseSepolia } from 'viem/chains'

export const SPLITTER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createSplitter',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sellingAgent', type: 'address' },
      { name: 'recipients',   type: 'address[]' },
      { name: 'bps',          type: 'uint16[]' },
      { name: 'salt',         type: 'bytes32' },
    ],
    outputs: [{ name: 'splitter', type: 'address' }],
  },
  {
    type: 'function',
    name: 'predictAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'salt',       type: 'bytes32' },
      { name: 'recipients', type: 'address[]' },
      { name: 'bps',        type: 'uint16[]' },
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
] as const

export interface DeploySplitterArgs {
  factoryAddress: `0x${string}`
  ensName:        string           // used as salt source (per spec 08A §3.3)
  sellerEoa:      `0x${string}`
  recipients:     `0x${string}`[]
  bps:            number[]
}

export interface DeploySplitterResult {
  splitter:         `0x${string}`
  splitterDeployTx: Hex | null     // null if already deployed (idempotent re-run)
  salt:             Hex
  externalLink:     string
}

export interface DeploySplitterClients {
  public: PublicClient
  wallet: WalletClient
}

export function makeDeploySplitterClients(
  rpcUrl: string,
  deployerPk: `0x${string}`,
): DeploySplitterClients {
  // Shared singleton nonceManager — see deploy-escrow.ts for the rationale.
  // Critical for the deployer/facilitator EOA which fires Escrow then
  // Splitter back-to-back in a single Worker invocation.
  const account = privateKeyToAccount(deployerPk, { nonceManager })
  return {
    public: createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 60_000 }) }) as PublicClient,
    wallet: createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl, { timeout: 60_000 }) }),
  }
}

/**
 * Compute the CREATE2 salt from an ENS name per spec 08A §3.3:
 *     salt = keccak256(abi.encodePacked(sellingAgentEnsName))
 * `abi.encodePacked` of a single string is the UTF-8 bytes.
 */
export function saltFromEnsName(ensName: string): Hex {
  return keccak256(toBytes(ensName))
}

/**
 * Step 2 — deploy the SellingAgent's Splitter via SplitterFactory on Base Sepolia.
 *
 * Idempotent: if `predictAddress` returns an address that `isDeployed` reports
 * true for, we skip the deploy and return the existing address with
 * `splitterDeployTx = null`.
 */
export async function deploySplitter(
  clients: DeploySplitterClients,
  args: DeploySplitterArgs,
): Promise<DeploySplitterResult> {
  const salt = saltFromEnsName(args.ensName)

  // Defensive: recipients[0] must equal sellerEoa (factory reverts otherwise,
  // but we get a better error message by catching here).
  if (args.recipients.length === 0 || args.recipients[0]!.toLowerCase() !== args.sellerEoa.toLowerCase()) {
    throw new Error(
      `deploy-splitter: recipients[0] must equal sellerEoa (got recipients[0]=${args.recipients[0]} vs sellerEoa=${args.sellerEoa})`,
    )
  }
  if (args.recipients.length !== args.bps.length) {
    throw new Error(`deploy-splitter: recipients.length (${args.recipients.length}) != bps.length (${args.bps.length})`)
  }

  const predicted = await clients.public.readContract({
    address: args.factoryAddress,
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'predictAddress',
    args: [salt, args.recipients, args.bps],
  }) as `0x${string}`

  const alreadyDeployed = await clients.public.readContract({
    address: args.factoryAddress,
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'isDeployed',
    args: [predicted],
  }) as boolean

  if (alreadyDeployed) {
    return {
      splitter:         predicted,
      splitterDeployTx: null,
      salt,
      externalLink:     `https://sepolia.basescan.org/address/${predicted}`,
    }
  }

  const tx = await clients.wallet.writeContract({
    address: args.factoryAddress,
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'createSplitter',
    args: [args.sellerEoa, args.recipients, args.bps, salt],
    account:  clients.wallet.account!,
    chain:    baseSepolia,
  })
  await clients.public.waitForTransactionReceipt({ hash: tx })

  return {
    splitter:         predicted,
    splitterDeployTx: tx,
    salt,
    externalLink:     `https://sepolia.basescan.org/tx/${tx}`,
  }
}
