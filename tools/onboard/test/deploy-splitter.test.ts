import { describe, test, expect } from 'vitest'
import { keccak256, toBytes } from 'viem'
import {
  deploySplitter, saltFromEnsName, SPLITTER_FACTORY_ABI,
  type DeploySplitterClients,
} from '../src/steps/deploy-splitter.js'

const FACTORY = '0xF000000000000000000000000000000000000001' as const
const SELLER  = '0xD53F000000000000000000000000000000000001' as const
const PREDICTED = '0xCAFE000000000000000000000000000000000001' as const

function makeClients(opts: {
  predicted?: `0x${string}`
  alreadyDeployed?: boolean
} = {}): { clients: DeploySplitterClients; reads: Array<{ args: unknown }>; writes: Array<{ args: unknown }> } {
  const reads: Array<{ args: unknown }> = []
  const writes: Array<{ args: unknown }> = []
  const publicClient = {
    async readContract(args: any) {
      reads.push({ args })
      if (args.functionName === 'predictAddress') return opts.predicted ?? PREDICTED
      if (args.functionName === 'isDeployed') return opts.alreadyDeployed ?? false
      throw new Error(`unexpected read: ${args.functionName}`)
    },
    async waitForTransactionReceipt(_: unknown) { return { status: 'success' } },
  }
  const wallet = {
    account: { address: '0xDEP10000000000000000000000000000000000000' },
    async writeContract(args: unknown) {
      writes.push({ args })
      return '0xabc1234567890000000000000000000000000000000000000000000000000000'
    },
  }
  return {
    clients: { public: publicClient as any, wallet: wallet as any },
    reads, writes,
  }
}

describe('deploySplitter', () => {
  test('happy path: predict → isDeployed=false → createSplitter with exact args', async () => {
    const { clients, reads, writes } = makeClients({ alreadyDeployed: false })
    const result = await deploySplitter(clients, {
      factoryAddress: FACTORY,
      ensName:        'seller9.reckon402-test.eth',
      sellerEoa:      SELLER,
      recipients:     [SELLER],
      bps:            [10_000],
    })

    const expectedSalt = keccak256(toBytes('seller9.reckon402-test.eth'))

    // predictAddress called with exact args (mock-passthrough guard)
    expect(reads[0]!.args).toMatchObject({
      address: FACTORY,
      functionName: 'predictAddress',
      args: [expectedSalt, [SELLER], [10_000]],
    })

    // isDeployed called with predicted address
    expect(reads[1]!.args).toMatchObject({
      address: FACTORY,
      functionName: 'isDeployed',
      args: [PREDICTED],
    })

    // createSplitter called with exact args
    expect(writes).toHaveLength(1)
    expect(writes[0]!.args).toMatchObject({
      address: FACTORY,
      functionName: 'createSplitter',
      args: [SELLER, [SELLER], [10_000], expectedSalt],
    })

    expect(result.splitter).toBe(PREDICTED)
    expect(result.splitterDeployTx).toBe('0xabc1234567890000000000000000000000000000000000000000000000000000')
    expect(result.salt).toBe(expectedSalt)
  })

  test('idempotent: already deployed → skips createSplitter, returns null tx', async () => {
    const { clients, writes } = makeClients({ alreadyDeployed: true })
    const result = await deploySplitter(clients, {
      factoryAddress: FACTORY,
      ensName:        'seller9.reckon402-test.eth',
      sellerEoa:      SELLER,
      recipients:     [SELLER],
      bps:            [10_000],
    })

    expect(writes).toHaveLength(0)
    expect(result.splitter).toBe(PREDICTED)
    expect(result.splitterDeployTx).toBeNull()
  })

  test('recipients[0] != sellerEoa → rejects with clear message (caught client-side, not on-chain)', async () => {
    const { clients, writes } = makeClients()
    const WRONG = '0xBAD0000000000000000000000000000000000000' as `0x${string}`
    await expect(deploySplitter(clients, {
      factoryAddress: FACTORY,
      ensName: 'seller9.reckon402-test.eth',
      sellerEoa: SELLER,
      recipients: [WRONG, SELLER],
      bps: [5_000, 5_000],
    })).rejects.toThrow(/recipients\[0\] must equal sellerEoa/)

    expect(writes).toHaveLength(0)  // never reached writeContract
  })

  test('recipients.length !== bps.length → rejects', async () => {
    const { clients } = makeClients()
    await expect(deploySplitter(clients, {
      factoryAddress: FACTORY,
      ensName: 'seller9.reckon402-test.eth',
      sellerEoa: SELLER,
      recipients: [SELLER],
      bps: [5_000, 5_000],
    })).rejects.toThrow(/recipients\.length.*bps\.length/)
  })

  test('multi-recipient split passes bps array through unchanged', async () => {
    const RECIP_B = '0xAAAA000000000000000000000000000000000000' as `0x${string}`
    const { clients, writes } = makeClients()
    await deploySplitter(clients, {
      factoryAddress: FACTORY,
      ensName: 'seller9.reckon402-test.eth',
      sellerEoa: SELLER,
      recipients: [SELLER, RECIP_B],
      bps: [7_000, 3_000],
    })
    expect(writes[0]!.args).toMatchObject({
      functionName: 'createSplitter',
      args: [SELLER, [SELLER, RECIP_B], [7_000, 3_000], expect.any(String)],
    })
  })

  test('saltFromEnsName is deterministic', () => {
    const a = saltFromEnsName('seller9.reckon402-test.eth')
    const b = saltFromEnsName('seller9.reckon402-test.eth')
    expect(a).toBe(b)
    const c = saltFromEnsName('seller10.reckon402-test.eth')
    expect(a).not.toBe(c)
  })

  test('ABI round-trip: SPLITTER_FACTORY_ABI exposes the locked function set', () => {
    const fns = SPLITTER_FACTORY_ABI.filter(e => e.type === 'function').map(e => e.name)
    expect(fns).toEqual(['createSplitter', 'predictAddress', 'isDeployed'])
  })
})
