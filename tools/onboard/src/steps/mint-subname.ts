import {
  createPublicClient, createWalletClient, http, keccak256, toBytes, namehash,
  type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import {
  ENS_REGISTRY_SEPOLIA,
  PARENT_RESOLVER_ENS_SEPOLIA,
} from '../types.js'

// Subset of ENSRegistry ABI we use. (The full ABI is in @ensdomains/ensjs but
// we avoid the dep — viem + handwritten ABI entries keep the tool lean.)
export const ENS_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'setSubnodeOwner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node',  type: 'bytes32' },
      { name: 'label', type: 'bytes32' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'setResolver',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node',     type: 'bytes32' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setOwner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node',  type: 'bytes32' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export interface MintSubnameArgs {
  parentName: string             // e.g. "reckon402-test.eth"
  label:      string             // e.g. "seller9"
  sellerEoa:  `0x${string}`
  // Final ownership transfer to sellerEoa is deferred to step 5 so that
  // intermediate setResolver / setAddr calls (also step 1) can still be
  // signed by the funder key. Set `transferToSeller=true` to perform the
  // final setOwner at the end of this step (not the default — the orchestrator
  // issues a single setOwner after set-ens-records completes).
  transferToSeller?: boolean
}

export interface MintSubnameResult {
  subnode:              Hex
  subnameRegisterTx:    Hex
  subnameOwnerTransferTx: Hex | null
  setResolverTx:        Hex
  externalLink:         string
}

export interface MintSubnameClients {
  public: PublicClient
  wallet: WalletClient
}

export function makeMintSubnameClients(
  rpcUrl: string,
  funderPk: `0x${string}`,
): MintSubnameClients {
  const account = privateKeyToAccount(funderPk)
  return {
    public: createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 60_000 }) }) as PublicClient,
    wallet: createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 60_000 }) }),
  }
}

/**
 * Step 1 — mint ENS subname on Sepolia.
 *
 * Order of writes (spec §3.2):
 *   a) setSubnodeOwner(parentNode, labelhash, funderEoa)
 *      — Temporarily owns the subnode with the funder key so the next two
 *        writes can be signed by the same key without requiring the seller's
 *        signature (we don't hold the seller's PK).
 *   b) setResolver(subnode, Reckon402Resolver)
 *      — Points the subnode at our CCIP-Read resolver so x402.* records
 *        resolve through the gateway.
 *   c) setOwner(subnode, sellerEoa)  [only if transferToSeller === true]
 *      — Final ownership transfer. Deferred to after set-ens-records runs,
 *        otherwise the ACL on signed-writes would already reject Reckon402
 *        writes for SellingAgent keys.
 *
 * Note: setAddr is NOT performed by this step. We set it as part of bootstrap
 * through the Reckon402Resolver (it consults the gateway's merchants.records
 * map for x402.* keys; for addr records, we rely on the wallet's UI-level
 * resolution defaulting to the ENS owner).
 */
export async function mintSubname(
  clients: MintSubnameClients,
  args: MintSubnameArgs,
  funderAddress: `0x${string}`,
): Promise<MintSubnameResult> {
  const parentNode = namehash(args.parentName)
  const labelhash  = keccak256(toBytes(args.label))
  const subnode    = namehash(`${args.label}.${args.parentName}`) as Hex

  // a) setSubnodeOwner → funder (temporary)
  const registerTx = await clients.wallet.writeContract({
    address: ENS_REGISTRY_SEPOLIA,
    abi: ENS_REGISTRY_ABI,
    functionName: 'setSubnodeOwner',
    args: [parentNode, labelhash, funderAddress],
    account:  clients.wallet.account!,
    chain:    sepolia,
  })
  await clients.public.waitForTransactionReceipt({ hash: registerTx })

  // b) setResolver → Reckon402Resolver
  const resolverTx = await clients.wallet.writeContract({
    address: ENS_REGISTRY_SEPOLIA,
    abi: ENS_REGISTRY_ABI,
    functionName: 'setResolver',
    args: [subnode, PARENT_RESOLVER_ENS_SEPOLIA],
    account:  clients.wallet.account!,
    chain:    sepolia,
  })
  await clients.public.waitForTransactionReceipt({ hash: resolverTx })

  // c) setOwner → seller (optional, deferred)
  let transferTx: Hex | null = null
  if (args.transferToSeller) {
    transferTx = await clients.wallet.writeContract({
      address: ENS_REGISTRY_SEPOLIA,
      abi: ENS_REGISTRY_ABI,
      functionName: 'setOwner',
      args: [subnode, args.sellerEoa],
      account:  clients.wallet.account!,
      chain:    sepolia,
    })
    await clients.public.waitForTransactionReceipt({ hash: transferTx })
  }

  return {
    subnode,
    subnameRegisterTx:      registerTx,
    subnameOwnerTransferTx: transferTx,
    setResolverTx:          resolverTx,
    externalLink:           `https://sepolia.etherscan.io/tx/${registerTx}`,
  }
}

/**
 * Post-onboarding transfer of subnode ownership from the funder to the seller.
 * Called by the orchestrator AFTER set-ens-records completes so that all
 * Reckon402-signed /admin/bootstrap writes succeed (ownership is still with
 * the funder/Reckon402 EOA during the bootstrap window).
 */
export async function transferSubnodeOwnership(
  clients: MintSubnameClients,
  subnode: Hex,
  sellerEoa: `0x${string}`,
): Promise<Hex> {
  const tx = await clients.wallet.writeContract({
    address: ENS_REGISTRY_SEPOLIA,
    abi: ENS_REGISTRY_ABI,
    functionName: 'setOwner',
    args: [subnode, sellerEoa],
    account:  clients.wallet.account!,
    chain:    sepolia,
  })
  await clients.public.waitForTransactionReceipt({ hash: tx })
  return tx
}
