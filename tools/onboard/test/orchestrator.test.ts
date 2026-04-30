import { describe, test, expect, vi } from 'vitest'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { runOnboard } from '../src/orchestrator.js'
import type { OnboardEnv, OnboardStep } from '../src/types.js'

const SELLER = getAddress('0xd53f000000000000000000000000000000000001') as `0x${string}`
const FACTORY = getAddress('0xf000000000000000000000000000000000000001') as `0x${string}`
const IDENTITY = getAddress('0x8004a818bfb912233c491871b3d84c89a494bd9e') as `0x${string}`
const PREDICTED_SPLITTER = getAddress('0xcafe000000000000000000000000000000000001') as `0x${string}`

function makeEnv(): OnboardEnv {
  const funderPk = generatePrivateKey()
  const deployerPk = generatePrivateKey()
  const onboardingPk = generatePrivateKey()
  return {
    ETH_SEPOLIA_RPC_PRIMARY:  'https://eth-sepolia.test',
    BASE_SEPOLIA_RPC_PRIMARY: 'https://base-sepolia.test',
    ENS_FUNDER_PK:            funderPk,
    RECKON402_DEPLOYER_PK:    deployerPk,
    RECKON402_ONBOARDING_PK:  onboardingPk,
    SPLITTER_FACTORY_ADDRESS: FACTORY,
    RECKON402_RESOLVER_SEPOLIA: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
    IDENTITY_REGISTRY_BASE_SEPOLIA: IDENTITY,
    GATEWAY_BASE_URL:         'https://gateway.test',
    FACILITATOR_BASE_URL:     'https://facilitator.test',
    CHAIN_ID_BASE_SEPOLIA:    84532,
  }
}

/**
 * Build a full plugin set that mocks each step's viem clients. Per
 * feedback_testing.md: every write records its args so tests can assert
 * exact payloads — not just "was called".
 */
function makePlugins(opts: {
  splitterAlreadyDeployed?: boolean
  agentId?: bigint
  failRegister?: boolean
  fetchImpl?: typeof fetch
} = {}) {
  const calls: {
    ensWrites: Array<{ args: any }>
    splitterReads: Array<{ args: any }>
    splitterWrites: Array<{ args: any }>
    identityWrites: Array<{ args: any }>
    fetchCalls: Array<{ url: string; init: RequestInit }>
  } = {
    ensWrites: [], splitterReads: [], splitterWrites: [], identityWrites: [], fetchCalls: [],
  }

  const agentId = opts.agentId ?? 3n

  const makeEnsClients = () => ({
    public: {
      async waitForTransactionReceipt() { return { status: 'success' } },
    } as any,
    wallet: {
      account: { address: getAddress('0xfeed000000000000000000000000000000000001') },
      async writeContract(args: any) {
        calls.ensWrites.push({ args })
        const n = calls.ensWrites.length
        return `0x${n.toString(16).padStart(64, '0')}`
      },
    } as any,
  })

  const makeSplitterClients = () => ({
    public: {
      async readContract(args: any) {
        calls.splitterReads.push({ args })
        if (args.functionName === 'predictAddress') return PREDICTED_SPLITTER
        if (args.functionName === 'isDeployed')     return opts.splitterAlreadyDeployed ?? false
        throw new Error(`unexpected read: ${args.functionName}`)
      },
      async waitForTransactionReceipt() { return { status: 'success' } },
    } as any,
    wallet: {
      account: { address: getAddress('0xde01000000000000000000000000000000000001') },
      async writeContract(args: any) {
        calls.splitterWrites.push({ args })
        const n = calls.splitterWrites.length
        return `0x${'c'.repeat(n)}${'0'.repeat(64 - n)}` as `0x${string}`
      },
    } as any,
  })

  // Identity client: writeContract returns a tx hash; waitForTransactionReceipt
  // returns a Transfer log so the step can recover agentId.
  const makeIdentityClients = () => {
    const deployerAddr = getAddress('0xde01000000000000000000000000000000000001') as `0x${string}`
    return {
      public: {
        async readContract() { return deployerAddr },
        async waitForTransactionReceipt() {
          if (opts.failRegister) throw new Error('RPC timeout')
          // Encode Transfer(0x0 → deployer, tokenId=agentId)
          const { encodeEventTopics, IDENTITY_ABI } = await (async () => {
            const viem = await import('viem')
            const mod  = await import('../src/steps/register-agent-id.js')
            return { encodeEventTopics: viem.encodeEventTopics, IDENTITY_ABI: mod.IDENTITY_ABI }
          })()
          const topics = encodeEventTopics({
            abi: IDENTITY_ABI,
            eventName: 'Transfer',
            args: {
              from: '0x0000000000000000000000000000000000000000',
              to: deployerAddr,
              tokenId: agentId,
            },
          })
          return {
            status: 'success',
            logs: [{ address: IDENTITY, data: '0x', topics }],
          }
        },
      } as any,
      wallet: {
        account: { address: deployerAddr },
        async writeContract(args: any) {
          calls.identityWrites.push({ args })
          if (opts.failRegister && args.functionName === 'register') {
            throw new Error('RPC timeout')
          }
          const n = calls.identityWrites.length
          return `0x${'a'.repeat(n)}${'0'.repeat(64 - n)}` as `0x${string}`
        },
      } as any,
    }
  }

  const fetchImpl = opts.fetchImpl ?? (async (url: any, init: any) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.fetchCalls.push({ url: u, init })
    if (u.endsWith('/admin/bootstrap')) {
      return new Response(JSON.stringify({ updated: true, ensName: 'x', keys: [], updatedAt: 1 }), { status: 200 })
    }
    if (u.endsWith('/admin/bootstrap/gateway-seed')) {
      return new Response(JSON.stringify({ seeded: true, ensName: 'x', chainId: 84532, agentId: '3', updatedAt: 1 }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as any

  return { plugins: { makeEnsClients, makeSplitterClients, makeIdentityClients, fetchImpl }, calls }
}

describe('runOnboard', () => {
  const baseArgs = {
    name:       'seller9.reckon402-test.eth',
    parentName: 'reckon402-test.eth',
    label:      'seller9',
    sellerEoa:  SELLER,
    endpoint:   'https://seller9.example.com/hello',
    amount:     '100000',
  }

  test('happy path: all 5 steps complete in order with progressSink called for each start/end', async () => {
    const env = makeEnv()
    const { plugins, calls } = makePlugins()
    const sinkEvents: OnboardStep[] = []

    const result = await runOnboard(env, {
      ...baseArgs,
      progressSink: (s) => { sinkEvents.push({ ...s }) },
    }, plugins)

    // Steps 1..5 each emit 2 events (start + end) → 10 total
    expect(sinkEvents.length).toBe(10)
    expect(sinkEvents.map(e => e.id)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])

    // Each step's second emission has completedAt and no error.
    for (let i = 1; i < sinkEvents.length; i += 2) {
      expect(sinkEvents[i]!.completedAt).toBeDefined()
      expect(sinkEvents[i]!.error).toBeUndefined()
    }

    // Step 1: first ENS write was setSubnodeOwner; second was setResolver.
    expect(calls.ensWrites[0]!.args.functionName).toBe('setSubnodeOwner')
    expect(calls.ensWrites[1]!.args.functionName).toBe('setResolver')

    // Step 2: factory writeContract was createSplitter with exact args (recipients[0]=seller, bps=[10000])
    expect(calls.splitterWrites).toHaveLength(1)
    expect(calls.splitterWrites[0]!.args).toMatchObject({
      address: FACTORY,
      functionName: 'createSplitter',
      args: [SELLER, [SELLER], [10_000], expect.any(String)],
    })

    // Step 3: register(tokenURI) then safeTransferFrom(deployer, seller, agentId=3n)
    expect(calls.identityWrites[0]!.args).toMatchObject({
      functionName: 'register',
      args: [`https://gateway.test/agents/${encodeURIComponent('seller9.reckon402-test.eth')}/metadata.json`],
    })
    expect(calls.identityWrites[1]!.args).toMatchObject({
      functionName: 'safeTransferFrom',
      args: [expect.any(String), SELLER, 3n],
    })

    // Step 4: POST /admin/bootstrap with records containing the freshly-deployed splitter + agentId
    const bootstrapCall = calls.fetchCalls.find(c => c.url.endsWith('/admin/bootstrap'))
    expect(bootstrapCall).toBeDefined()
    const bootstrapBody = JSON.parse(bootstrapCall!.init.body as string)
    expect(bootstrapBody.records).toMatchObject({
      'x402.splitter':         PREDICTED_SPLITTER,
      'x402.facilitator':      'https://facilitator.test',
      'x402.erc8004.agent_id': '3',
      'x402.endpoint':         'https://seller9.example.com/hello',
      'x402.amount':           '100000',
    })

    // Step 5: POST /admin/bootstrap/gateway-seed, then setOwner(subnode, seller)
    const seedCall = calls.fetchCalls.find(c => c.url.endsWith('/gateway-seed'))
    expect(seedCall).toBeDefined()

    // The final ENS write is setOwner(subnode, seller)
    const lastEns = calls.ensWrites[calls.ensWrites.length - 1]!
    expect(lastEns.args.functionName).toBe('setOwner')
    expect(lastEns.args.args[1]).toBe(SELLER)

    // Result shape
    expect(result.ensName).toBe('seller9.reckon402-test.eth')
    expect(result.agentId).toBe(3n)
    expect(result.splitter).toBe(PREDICTED_SPLITTER)
    expect(result.splitterDeployTx).toMatch(/^0x/)
    expect(result.subnameRegisterTx).toMatch(/^0x/)
    expect(result.steps).toHaveLength(5)
    expect(result.steps.every(s => s.error === undefined)).toBe(true)
  })

  test('step 2 already-deployed: no createSplitter write; splitter address still returned', async () => {
    const env = makeEnv()
    const { plugins, calls } = makePlugins({ splitterAlreadyDeployed: true })
    const result = await runOnboard(env, baseArgs, plugins)

    expect(calls.splitterWrites).toHaveLength(0)  // no deploy
    expect(result.splitter).toBe(PREDICTED_SPLITTER)
    expect(result.splitterDeployTx).toBeNull()
  })

  test('step 3 RPC failure: partial result via progressSink; error on step 3; later steps not run', async () => {
    const env = makeEnv()
    const { plugins, calls } = makePlugins({ failRegister: true })
    const sinkEvents: OnboardStep[] = []

    await expect(
      runOnboard(env, { ...baseArgs, progressSink: (s) => { sinkEvents.push({ ...s }) } }, plugins),
    ).rejects.toThrow(/RPC timeout/)

    // Sink should have steps 1, 1, 2, 2, 3 (start), 3 (end-with-error)
    expect(sinkEvents.map(e => e.id)).toEqual([1, 1, 2, 2, 3, 3])
    expect(sinkEvents[5]!.error).toMatch(/RPC timeout/)

    // No /admin/bootstrap call — we bailed before step 4
    expect(calls.fetchCalls).toHaveLength(0)
  })

  test('progressSink receives every step transition (async callback awaited)', async () => {
    const env = makeEnv()
    const { plugins } = makePlugins()
    const order: string[] = []
    await runOnboard(env, {
      ...baseArgs,
      progressSink: async (s) => {
        await new Promise(r => setTimeout(r, 0))
        order.push(`${s.id}:${s.completedAt ? 'end' : 'start'}`)
      },
    }, plugins)
    expect(order).toEqual([
      '1:start', '1:end',
      '2:start', '2:end',
      '3:start', '3:end',
      '4:start', '4:end',
      '5:start', '5:end',
    ])
  })

  test('idempotent re-run: step 2 already deployed + step 4/5 succeed → full result still returned', async () => {
    const env = makeEnv()
    const { plugins, calls } = makePlugins({ splitterAlreadyDeployed: true, agentId: 99n })
    const result = await runOnboard(env, baseArgs, plugins)

    expect(result.agentId).toBe(99n)
    expect(result.splitter).toBe(PREDICTED_SPLITTER)
    expect(result.splitterDeployTx).toBeNull()
    expect(result.steps).toHaveLength(5)
    expect(calls.fetchCalls.length).toBeGreaterThanOrEqual(2)  // bootstrap + gateway-seed
  })
})
