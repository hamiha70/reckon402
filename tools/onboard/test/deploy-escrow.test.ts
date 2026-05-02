import { describe, test, expect } from 'vitest'
import { getAddress, keccak256, toBytes } from 'viem'
import {
  deployEscrow,
  predictEscrowAddress,
  escrowSaltFromEnsName,
  type DeployEscrowArgs,
  type DeployEscrowClients,
} from '../src/steps/deploy-escrow.js'

const FACTORY            = getAddress('0xfac1000000000000000000000000000000000001') as `0x${string}`
const STRATEGY           = getAddress('0xc498000000000000000000000000000000000001') as `0x${string}`
const FACILITATOR_CLIENT = getAddress('0x0a0228e6a5e1d7be234a190a8d9a3af9e08ec455') as `0x${string}`
const PREDICTED_ESCROW   = getAddress('0xea8b000000000000000000000000000000000001') as `0x${string}`
const ZERO               = '0x0000000000000000000000000000000000000000' as `0x${string}`

const baseArgs: DeployEscrowArgs = {
  factoryAddress:    FACTORY,
  ensName:           'seller10.reckon402-test.eth',
  agentId:           42n,
  facilitatorClient: FACILITATOR_CLIENT,
  tierStrategy:      STRATEGY,
  tag1:              'payment',
  tag2:              'x402-settlement',
}

interface CallLog {
  reads:  Array<{ functionName: string; args: any }>
  writes: Array<{ functionName: string; args: any }>
}

function makeClients(opts: {
  predicted?:        `0x${string}`
  escrowOfAgent?:    `0x${string}`
  isDeployed?:       boolean
}): { clients: DeployEscrowClients; calls: CallLog } {
  const calls: CallLog = { reads: [], writes: [] }
  const predicted     = opts.predicted     ?? PREDICTED_ESCROW
  const escrowOfAgent = opts.escrowOfAgent ?? ZERO
  const isDeployed    = opts.isDeployed    ?? false

  const clients: DeployEscrowClients = {
    public: {
      async readContract(args: any) {
        calls.reads.push({ functionName: args.functionName, args: args.args })
        if (args.functionName === 'predictAddress')  return predicted
        if (args.functionName === 'escrowOfAgent')   return escrowOfAgent
        if (args.functionName === 'isDeployed')      return isDeployed
        throw new Error(`unexpected read: ${args.functionName}`)
      },
      async waitForTransactionReceipt() { return { status: 'success' } },
    } as any,
    wallet: {
      account: { address: getAddress('0x0a0228e6a5e1d7be234a190a8d9a3af9e08ec455') },
      async writeContract(args: any) {
        calls.writes.push({ functionName: args.functionName, args: args.args })
        return '0xdeadbeef'.padEnd(66, '0') as `0x${string}`
      },
    } as any,
  }
  return { clients, calls }
}

describe('escrowSaltFromEnsName', () => {
  test('matches keccak256 of UTF-8 bytes', () => {
    const s = escrowSaltFromEnsName('seller10.reckon402-test.eth')
    expect(s).toBe(keccak256(toBytes('seller10.reckon402-test.eth')))
  })

  test('different ensName -> different salt', () => {
    const a = escrowSaltFromEnsName('seller10.reckon402-test.eth')
    const b = escrowSaltFromEnsName('seller11.reckon402-test.eth')
    expect(a).not.toBe(b)
  })
})

describe('predictEscrowAddress', () => {
  test('returns the factory.predictAddress result with the canonical salt', async () => {
    const { clients, calls } = makeClients({})
    const out = await predictEscrowAddress(clients, baseArgs)

    expect(out.escrow).toBe(PREDICTED_ESCROW)
    expect(out.salt).toBe(escrowSaltFromEnsName(baseArgs.ensName))

    expect(calls.reads).toHaveLength(1)
    expect(calls.reads[0]).toEqual({
      functionName: 'predictAddress',
      args: [
        42n,
        FACILITATOR_CLIENT,
        STRATEGY,
        'payment',
        'x402-settlement',
        out.salt,
      ],
    })
    expect(calls.writes).toHaveLength(0)
  })
})

describe('deployEscrow', () => {
  test('happy path: predict → no existing → createEscrow with full arg shape', async () => {
    const { clients, calls } = makeClients({})

    const out = await deployEscrow(clients, baseArgs)
    const expectedSalt = escrowSaltFromEnsName(baseArgs.ensName)

    expect(out.escrow).toBe(PREDICTED_ESCROW)
    expect(out.escrowDeployTx).toMatch(/^0x[0-9a-f]+$/)
    expect(out.salt).toBe(expectedSalt)
    expect(out.externalLink).toBe(`https://sepolia.basescan.org/tx/${out.escrowDeployTx}`)

    // Read sequence: escrowOfAgent → predictAddress → isDeployed.
    expect(calls.reads.map(r => r.functionName)).toEqual([
      'escrowOfAgent', 'predictAddress', 'isDeployed',
    ])
    expect(calls.reads[0]!.args).toEqual([42n])

    // Write: createEscrow with the canonical 6-arg shape.
    expect(calls.writes).toHaveLength(1)
    expect(calls.writes[0]).toEqual({
      functionName: 'createEscrow',
      args: [
        42n,
        FACILITATOR_CLIENT,
        STRATEGY,
        'payment',
        'x402-settlement',
        expectedSalt,
      ],
    })
  })

  test('idempotent: escrowOfAgent already non-zero → no predict, no createEscrow', async () => {
    const { clients, calls } = makeClients({
      escrowOfAgent: PREDICTED_ESCROW,
    })

    const out = await deployEscrow(clients, baseArgs)

    expect(out.escrow).toBe(PREDICTED_ESCROW)
    expect(out.escrowDeployTx).toBeNull()
    expect(out.externalLink).toBe(`https://sepolia.basescan.org/address/${PREDICTED_ESCROW}`)

    // Only the escrowOfAgent read happens; predict + isDeployed are skipped.
    expect(calls.reads.map(r => r.functionName)).toEqual(['escrowOfAgent'])
    expect(calls.writes).toHaveLength(0)
  })

  test('idempotent: predicted address already has code (isDeployed=true) → no createEscrow', async () => {
    const { clients, calls } = makeClients({
      escrowOfAgent: ZERO,        // factory has no record for this agentId
      isDeployed:    true,        // but the predicted address already has code
    })

    const out = await deployEscrow(clients, baseArgs)

    expect(out.escrow).toBe(PREDICTED_ESCROW)
    expect(out.escrowDeployTx).toBeNull()

    // Read sequence: escrowOfAgent → predictAddress → isDeployed.
    // No write — we found a deployed contract at the predicted address.
    expect(calls.reads.map(r => r.functionName)).toEqual([
      'escrowOfAgent', 'predictAddress', 'isDeployed',
    ])
    expect(calls.writes).toHaveLength(0)
  })
})
