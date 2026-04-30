import { describe, test, expect } from 'vitest'
import { encodeEventTopics, pad, toHex } from 'viem'
import {
  registerAgentId, IDENTITY_ABI,
  type RegisterAgentIdClients,
} from '../src/steps/register-agent-id.js'

import { getAddress } from 'viem'

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
const DEPLOYER = getAddress('0xde01000000000000000000000000000000000001') as `0x${string}`
const SELLER   = getAddress('0xd53f000000000000000000000000000000000001') as `0x${string}`

function makeClients(opts: { agentId?: bigint; toAddress?: `0x${string}` } = {}) {
  const writes: Array<{ args: unknown }> = []
  const reads: Array<{ args: unknown }> = []
  const agentId = opts.agentId ?? 7n
  const toAddress = opts.toAddress ?? DEPLOYER

  // Build realistic Transfer(from=0x0, to=deployer, tokenId=agentId) log entry.
  // ERC-721 Transfer topic: keccak256('Transfer(address,address,uint256)')
  const transferTopics = encodeEventTopics({
    abi: IDENTITY_ABI,
    eventName: 'Transfer',
    args: {
      from: '0x0000000000000000000000000000000000000000',
      to:   toAddress,
      tokenId: agentId,
    },
  })

  const receipt = {
    status: 'success',
    logs: [{
      address: REGISTRY,
      data: '0x',
      topics: transferTopics,
    }],
  }

  let txCounter = 0
  const wallet = {
    account: { address: DEPLOYER },
    async writeContract(args: unknown) {
      writes.push({ args })
      txCounter += 1
      return `0x${txCounter.toString(16).padStart(64, '0')}` as `0x${string}`
    },
  }
  const publicClient = {
    async readContract(args: unknown) {
      reads.push({ args })
      return DEPLOYER
    },
    async waitForTransactionReceipt(_: unknown) { return receipt },
  }

  return {
    clients: { public: publicClient as any, wallet: wallet as any } as RegisterAgentIdClients,
    writes, reads,
  }
}

describe('registerAgentId', () => {
  test('happy path: register then safeTransferFrom deployer → seller', async () => {
    const { clients, writes } = makeClients({ agentId: 7n, toAddress: DEPLOYER })
    const result = await registerAgentId(clients, {
      identityRegistry: REGISTRY,
      tokenURI: 'https://gateway.reckon402.com/agents/seller9.reckon402-test.eth/metadata.json',
      deployerEoa: DEPLOYER,
      sellerEoa:   SELLER,
    })

    expect(writes).toHaveLength(2)

    // First: register(tokenURI)
    expect(writes[0]!.args).toMatchObject({
      address: REGISTRY,
      functionName: 'register',
      args: ['https://gateway.reckon402.com/agents/seller9.reckon402-test.eth/metadata.json'],
    })

    // Second: safeTransferFrom(deployer, seller, agentId)
    expect(writes[1]!.args).toMatchObject({
      address: REGISTRY,
      functionName: 'safeTransferFrom',
      args: [DEPLOYER, SELLER, 7n],
    })

    expect(result.agentId).toBe(7n)
    expect(result.agentRegisterTx).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    expect(result.agentTransferTx).toBe('0x0000000000000000000000000000000000000000000000000000000000000002')
  })

  test('deployer === seller → skips safeTransferFrom', async () => {
    const { clients, writes } = makeClients({ agentId: 7n, toAddress: DEPLOYER })
    const result = await registerAgentId(clients, {
      identityRegistry: REGISTRY,
      tokenURI: 'https://gateway.reckon402.com/x.json',
      deployerEoa: DEPLOYER,
      sellerEoa:   DEPLOYER,
    })
    expect(writes).toHaveLength(1)
    expect(result.agentTransferTx).toBeNull()
  })

  test('no Transfer event in receipt → throws with tx hash in message', async () => {
    // Override with receipt that has no matching log.
    const writes: Array<{ args: unknown }> = []
    const wallet = {
      account: { address: DEPLOYER },
      async writeContract(args: unknown) { writes.push({ args }); return '0xdead000000000000000000000000000000000000000000000000000000000001' },
    }
    const publicClient = {
      async waitForTransactionReceipt(_: unknown) { return { status: 'success', logs: [] } },
    }
    const clients = { public: publicClient as any, wallet: wallet as any } as RegisterAgentIdClients

    await expect(registerAgentId(clients, {
      identityRegistry: REGISTRY,
      tokenURI: 'https://x.example.com/',
      deployerEoa: DEPLOYER,
      sellerEoa: SELLER,
    })).rejects.toThrow(/Transfer event not found/)
  })
})
