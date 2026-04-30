import { describe, test, expect, vi } from 'vitest'
import { keccak256, toBytes, namehash } from 'viem'
import {
  mintSubname, transferSubnodeOwnership,
  ENS_REGISTRY_ABI, type MintSubnameClients,
} from '../src/steps/mint-subname.js'
import { ENS_REGISTRY_SEPOLIA, PARENT_RESOLVER_ENS_SEPOLIA } from '../src/types.js'

function makeClients(): { clients: MintSubnameClients; writes: Array<{ args: unknown }> } {
  const writes: Array<{ args: unknown }> = []
  let counter = 0
  const wallet = {
    account: { address: '0x1111111111111111111111111111111111111111' },
    async writeContract(args: unknown) {
      writes.push({ args })
      counter += 1
      // Deterministic fake tx hash keyed by counter.
      return `0x${counter.toString(16).padStart(64, '0')}`
    },
  }
  const publicClient = {
    async waitForTransactionReceipt(_: unknown) { return { status: 'success' } },
  }
  return {
    clients: { public: publicClient as unknown as MintSubnameClients['public'], wallet: wallet as unknown as MintSubnameClients['wallet'] },
    writes,
  }
}

describe('mintSubname', () => {
  const FUNDER = '0x1111111111111111111111111111111111111111' as const
  const SELLER = '0xD53F000000000000000000000000000000000001' as const

  test('default flow (transferToSeller=false): setSubnodeOwner → setResolver, funder retains ownership', async () => {
    const { clients, writes } = makeClients()
    const result = await mintSubname(clients, {
      parentName: 'reckon402-test.eth',
      label:      'seller9',
      sellerEoa:  SELLER,
    }, FUNDER)

    expect(writes).toHaveLength(2)

    // Write 1: setSubnodeOwner(parent, labelhash, funder)
    expect(writes[0]!.args).toMatchObject({
      address: ENS_REGISTRY_SEPOLIA,
      functionName: 'setSubnodeOwner',
      args: [
        namehash('reckon402-test.eth'),
        keccak256(toBytes('seller9')),
        FUNDER,
      ],
    })

    // Write 2: setResolver(subnode, Reckon402Resolver)
    expect(writes[1]!.args).toMatchObject({
      address: ENS_REGISTRY_SEPOLIA,
      functionName: 'setResolver',
      args: [namehash('seller9.reckon402-test.eth'), PARENT_RESOLVER_ENS_SEPOLIA],
    })

    // Result shape
    expect(result.subnode).toBe(namehash('seller9.reckon402-test.eth'))
    expect(result.subnameOwnerTransferTx).toBeNull()
    expect(result.subnameRegisterTx).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    expect(result.setResolverTx).toBe('0x0000000000000000000000000000000000000000000000000000000000000002')
    expect(result.externalLink).toContain('etherscan.io/tx/')
  })

  test('transferToSeller=true: appends setOwner(subnode, seller)', async () => {
    const { clients, writes } = makeClients()
    const result = await mintSubname(clients, {
      parentName: 'reckon402-test.eth',
      label:      'seller9',
      sellerEoa:  SELLER,
      transferToSeller: true,
    }, FUNDER)

    expect(writes).toHaveLength(3)
    expect(writes[2]!.args).toMatchObject({
      address: ENS_REGISTRY_SEPOLIA,
      functionName: 'setOwner',
      args: [namehash('seller9.reckon402-test.eth'), SELLER],
    })
    expect(result.subnameOwnerTransferTx).toBe('0x0000000000000000000000000000000000000000000000000000000000000003')
  })

  test('ABI round-trip: the ABI we pass is the locked subset', async () => {
    const functions = ENS_REGISTRY_ABI.filter(e => e.type === 'function').map(e => e.name)
    expect(functions).toEqual(['setSubnodeOwner', 'setResolver', 'setOwner', 'owner'])
  })
})

describe('transferSubnodeOwnership', () => {
  const SELLER = '0xD53F000000000000000000000000000000000001' as const

  test('calls setOwner(subnode, seller) with exact args', async () => {
    const { clients, writes } = makeClients()
    const subnode = namehash('seller9.reckon402-test.eth')
    const tx = await transferSubnodeOwnership(clients, subnode, SELLER)

    expect(writes).toHaveLength(1)
    expect(writes[0]!.args).toMatchObject({
      address: ENS_REGISTRY_SEPOLIA,
      functionName: 'setOwner',
      args: [subnode, SELLER],
    })
    expect(tx).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})
