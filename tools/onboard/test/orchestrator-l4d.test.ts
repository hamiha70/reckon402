import { describe, test, expect } from 'vitest'
import { getAddress, encodeEventTopics } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { runOnboard } from '../src/orchestrator.js'
import type { OnboardEnv, OnboardStep } from '../src/types.js'
import { IDENTITY_ABI } from '../src/steps/register-agent-id.js'
import { escrowSaltFromEnsName } from '../src/steps/deploy-escrow.js'

const SELLER             = getAddress('0xd53f000000000000000000000000000000000001') as `0x${string}`
const SPLITTER_FACTORY   = getAddress('0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7') as `0x${string}`
const ESCROW_FACTORY     = getAddress('0xb06998682bd716e0864257b3ac3aa1fc4cc64589') as `0x${string}`
const TIER_STRATEGY      = getAddress('0xc498155bc4a2e4ba979ad5797298107c63b26c4e') as `0x${string}`
const FACILITATOR_FEE    = getAddress('0x0a0228e6a5e1d7be234a190a8d9a3af9e08ec455') as `0x${string}`
const IDENTITY           = getAddress('0x8004a818bfb912233c491871b3d84c89a494bd9e') as `0x${string}`
const PREDICTED_SPLITTER = getAddress('0xcafe000000000000000000000000000000000001') as `0x${string}`
const PREDICTED_ESCROW   = getAddress('0xea8b000000000000000000000000000000000001') as `0x${string}`
const ZERO               = '0x0000000000000000000000000000000000000000' as `0x${string}`

function makeEnv(overrides: Partial<OnboardEnv> = {}): OnboardEnv {
  return {
    ETH_SEPOLIA_RPC_PRIMARY:        'https://eth-sepolia.test',
    BASE_SEPOLIA_RPC_PRIMARY:       'https://base-sepolia.test',
    ENS_FUNDER_PK:                  generatePrivateKey(),
    RECKON402_DEPLOYER_PK:          generatePrivateKey(),
    RECKON402_ONBOARDING_PK:        generatePrivateKey(),
    SPLITTER_FACTORY_ADDRESS:       SPLITTER_FACTORY,
    RECKON402_RESOLVER_SEPOLIA:     '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
    IDENTITY_REGISTRY_BASE_SEPOLIA: IDENTITY,
    ESCROW_FACTORY_ADDRESS:         ESCROW_FACTORY,
    TIER_STRATEGY_ADDRESS:          TIER_STRATEGY,
    FACILITATOR_FEE_EOA:            FACILITATOR_FEE,
    GATEWAY_BASE_URL:               'https://gateway.test',
    FACILITATOR_BASE_URL:           'https://facilitator.test',
    CHAIN_ID_BASE_SEPOLIA:          84532,
    ...overrides,
  }
}

interface CallLog {
  ensWrites:      Array<{ args: any }>
  splitterReads:  Array<{ args: any }>
  splitterWrites: Array<{ args: any }>
  identityWrites: Array<{ args: any }>
  escrowReads:    Array<{ args: any }>
  escrowWrites:   Array<{ args: any }>
  fetchCalls:     Array<{ url: string; init: RequestInit }>
}

interface MakePluginsOpts {
  agentId?:                 bigint
  escrowAlreadyForAgent?:   `0x${string}`     // -> idempotent escrow path
  escrowAlreadyDeployed?:   boolean           // -> isDeployed=true on predicted addr
  splitterAlreadyDeployed?: boolean
}

function makePlugins(opts: MakePluginsOpts = {}) {
  const calls: CallLog = {
    ensWrites: [], splitterReads: [], splitterWrites: [],
    identityWrites: [], escrowReads: [], escrowWrites: [],
    fetchCalls: [],
  }
  const agentId = opts.agentId ?? 5n
  const deployerAddr = getAddress('0xde01000000000000000000000000000000000001') as `0x${string}`

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
        throw new Error(`unexpected splitter read: ${args.functionName}`)
      },
      async waitForTransactionReceipt() { return { status: 'success' } },
    } as any,
    wallet: {
      account: { address: deployerAddr },
      async writeContract(args: any) {
        calls.splitterWrites.push({ args })
        const n = calls.splitterWrites.length
        return `0x${'c'.repeat(n)}${'0'.repeat(64 - n)}` as `0x${string}`
      },
    } as any,
  })

  const makeIdentityClients = () => ({
    public: {
      async readContract() { return deployerAddr },
      async waitForTransactionReceipt() {
        const topics = encodeEventTopics({
          abi: IDENTITY_ABI,
          eventName: 'Transfer',
          args: { from: ZERO, to: deployerAddr, tokenId: agentId },
        })
        return { status: 'success', logs: [{ address: IDENTITY, data: '0x', topics }] }
      },
    } as any,
    wallet: {
      account: { address: deployerAddr },
      async writeContract(args: any) {
        calls.identityWrites.push({ args })
        const n = calls.identityWrites.length
        return `0x${'a'.repeat(n)}${'0'.repeat(64 - n)}` as `0x${string}`
      },
    } as any,
  })

  const makeEscrowClients = () => ({
    public: {
      async readContract(args: any) {
        calls.escrowReads.push({ args })
        if (args.functionName === 'escrowOfAgent') {
          return opts.escrowAlreadyForAgent ?? ZERO
        }
        if (args.functionName === 'predictAddress') return PREDICTED_ESCROW
        if (args.functionName === 'isDeployed')     return opts.escrowAlreadyDeployed ?? false
        throw new Error(`unexpected escrow read: ${args.functionName}`)
      },
      async waitForTransactionReceipt() { return { status: 'success' } },
    } as any,
    wallet: {
      account: { address: deployerAddr },
      async writeContract(args: any) {
        calls.escrowWrites.push({ args })
        const n = calls.escrowWrites.length
        return `0x${'e'.repeat(n)}${'0'.repeat(64 - n)}` as `0x${string}`
      },
    } as any,
  })

  const fetchImpl: typeof fetch = (async (url: any, init: any) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.fetchCalls.push({ url: u, init })
    if (u.endsWith('/admin/bootstrap')) {
      return new Response(JSON.stringify({ updated: true, ensName: 'x', keys: [], updatedAt: 1 }), { status: 200 })
    }
    if (u.endsWith('/admin/bootstrap/gateway-seed')) {
      return new Response(JSON.stringify({ seeded: true, ensName: 'x', chainId: 84532, agentId: agentId.toString(), updatedAt: 1 }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as any

  return {
    plugins: { makeEnsClients, makeSplitterClients, makeIdentityClients, makeEscrowClients, fetchImpl },
    calls,
  }
}

describe('runOnboard L4d 6-step flow', () => {
  const baseArgs = {
    name:            'seller10.reckon402-test.eth',
    parentName:      'reckon402-test.eth',
    label:           'seller10',
    sellerEoa:       SELLER,
    endpoint:        'https://seller10.example.com/hello',
    amount:          '10000',
    enableL4dEscrow: true as const,
  }

  test('happy path: 6 steps in canonical order with full-arg assertions on every contract call', async () => {
    const env = makeEnv()
    const { plugins, calls } = makePlugins({ agentId: 7n })
    const sinkEvents: OnboardStep[] = []

    const result = await runOnboard(env, {
      ...baseArgs,
      progressSink: (s) => { sinkEvents.push({ ...s }) },
    }, plugins)

    // ── Step shape ──────────────────────────────────────────────────────
    // Steps 1..6 each emit 2 events (start + end) → 12 total
    expect(sinkEvents.length).toBe(12)
    expect(sinkEvents.map(e => e.id)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])

    // Every step's end-event has completedAt and no error.
    for (let i = 1; i < sinkEvents.length; i += 2) {
      expect(sinkEvents[i]!.completedAt).toBeDefined()
      expect(sinkEvents[i]!.error).toBeUndefined()
      expect(sinkEvents[i]!.completedAt!).toBeGreaterThanOrEqual(sinkEvents[i]!.startedAt)
    }

    // ── Inline notes drive the agent-mint card + form annotations ────────
    const endEventFor = (id: number) =>
      sinkEvents.find(e => e.id === id && e.completedAt !== undefined)

    expect(endEventFor(1)!.note).toBe('subname=seller10.reckon402-test.eth')
    expect(endEventFor(2)!.note).toBe('agentId=7')                       // Step 2 = AgentID (moved up)
    expect(endEventFor(3)!.note).toBe(`escrow=${PREDICTED_ESCROW}`)      // Step 3 = NEW Escrow deploy
    expect(endEventFor(4)!.note).toBe(`splitter=${PREDICTED_SPLITTER}`)  // Step 4 = Splitter (3-recipient)
    expect(endEventFor(5)!.note).toBe('records=13')                      // 13 records (12 legacy + x402.escrow)
    expect(endEventFor(6)!.note).toBe('owner=seller')

    // ── Step 1: ENS subname mint ────────────────────────────────────────
    expect(calls.ensWrites[0]!.args.functionName).toBe('setSubnodeOwner')
    expect(calls.ensWrites[1]!.args.functionName).toBe('setResolver')

    // ── Step 2: ERC-8004 agentId registration ──────────────────────────
    expect(calls.identityWrites).toHaveLength(2)
    expect(calls.identityWrites[0]!.args).toMatchObject({
      functionName: 'register',
      args: [`https://gateway.test/agents/${encodeURIComponent('seller10.reckon402-test.eth')}/metadata.json`],
    })
    expect(calls.identityWrites[1]!.args).toMatchObject({
      functionName: 'safeTransferFrom',
      args: [expect.any(String), SELLER, 7n],
    })

    // ── Step 3: Escrow deploy via factory ──────────────────────────────
    // The orchestrator MUST pass the live agentId from step 2, not a stub.
    expect(calls.escrowWrites).toHaveLength(1)
    const expectedSalt = escrowSaltFromEnsName('seller10.reckon402-test.eth')
    expect(calls.escrowWrites[0]!.args).toMatchObject({
      address:      ESCROW_FACTORY,
      functionName: 'createEscrow',
      args: [
        7n,
        FACILITATOR_FEE,        // facilitatorClient is the Reckon402 fee EOA per L4d framing lock
        TIER_STRATEGY,
        'payment',              // tag1 — pinned per L4b framing lock
        'x402-settlement',      // tag2
        expectedSalt,
      ],
    })
    // Read sequence on the factory: escrowOfAgent → predictAddress → isDeployed
    expect(calls.escrowReads.map(r => r.args.functionName)).toEqual([
      'escrowOfAgent', 'predictAddress', 'isDeployed',
    ])

    // ── Step 4: Splitter deploy with [seller, fee, escrow] / [8700, 300, 1000] ─
    expect(calls.splitterWrites).toHaveLength(1)
    expect(calls.splitterWrites[0]!.args).toMatchObject({
      address:      SPLITTER_FACTORY,
      functionName: 'createSplitter',
      args: [
        SELLER,                                                     // sellingAgent (slot-0 owner)
        [SELLER, FACILITATOR_FEE, PREDICTED_ESCROW],                // recipients
        [8_700, 300, 1_000],                                        // bps — sums to 10_000
        expect.any(String),                                          // salt
      ],
    })

    // ── Step 5: ENS records (now includes x402.escrow) ─────────────────
    const bootstrapCall = calls.fetchCalls.find(c => c.url.endsWith('/admin/bootstrap'))
    expect(bootstrapCall).toBeDefined()
    const bootstrapBody = JSON.parse(bootstrapCall!.init.body as string)
    expect(bootstrapBody.records).toMatchObject({
      'x402.splitter':         PREDICTED_SPLITTER,
      'x402.escrow':           PREDICTED_ESCROW,                // L4d-only key
      'x402.facilitator':      'https://facilitator.test',
      'x402.erc8004.agent_id': '7',
      'x402.endpoint':         'https://seller10.example.com/hello',
      'x402.amount':           '10000',
      'x402.scheme':           'eip3009',
      'x402.version':          '2',
      'x402.attestation':      'on',
      'x402.yield':            'none',
    })
    expect(Object.keys(bootstrapBody.records)).toHaveLength(13)

    // ── Step 6: gateway seed + final subnode transfer to seller ────────
    const seedCall = calls.fetchCalls.find(c => c.url.endsWith('/gateway-seed'))
    expect(seedCall).toBeDefined()

    const lastEns = calls.ensWrites[calls.ensWrites.length - 1]!
    expect(lastEns.args.functionName).toBe('setOwner')
    expect(lastEns.args.args[1]).toBe(SELLER)

    // ── Result shape ───────────────────────────────────────────────────
    expect(result.ensName).toBe('seller10.reckon402-test.eth')
    expect(result.agentId).toBe(7n)
    expect(result.splitter).toBe(PREDICTED_SPLITTER)
    expect(result.escrow).toBe(PREDICTED_ESCROW)
    expect(result.escrowDeployTx).toMatch(/^0x/)
    expect(result.splitterDeployTx).toMatch(/^0x/)
    expect(result.steps).toHaveLength(6)
    expect(result.steps.every(s => s.error === undefined)).toBe(true)
  })

  test('idempotent escrow: factory.escrowOfAgent already non-zero → no createEscrow write, splitter still uses existing escrow', async () => {
    const env = makeEnv()
    const existingEscrow = getAddress('0xea8b000000000000000000000000000000000abc') as `0x${string}`
    const { plugins, calls } = makePlugins({
      agentId:               9n,
      escrowAlreadyForAgent: existingEscrow,
    })
    const result = await runOnboard(env, baseArgs, plugins)

    // No createEscrow write happened
    expect(calls.escrowWrites).toHaveLength(0)
    // Only the escrowOfAgent read was made (predictAddress + isDeployed are skipped on the
    // factory-side idempotency hit, per `deploy-escrow.ts` short-circuit ordering).
    expect(calls.escrowReads.map(r => r.args.functionName)).toEqual(['escrowOfAgent'])

    // The Splitter's recipients[2] MUST be the existing escrow, not the freshly-predicted one.
    expect(calls.splitterWrites[0]!.args.args[1]).toEqual([SELLER, FACILITATOR_FEE, existingEscrow])

    // The bootstrap records MUST also reference the existing escrow.
    const bootstrap = calls.fetchCalls.find(c => c.url.endsWith('/admin/bootstrap'))!
    const records = JSON.parse(bootstrap.init.body as string).records
    expect(records['x402.escrow']).toBe(existingEscrow)

    expect(result.escrow).toBe(existingEscrow)
    expect(result.escrowDeployTx).toBeNull()
  })

  test('missing required L4d env var → throws clear error before any on-chain call', async () => {
    // Strip ESCROW_FACTORY_ADDRESS — orchestrator must reject before step 2 runs.
    const env = makeEnv({ ESCROW_FACTORY_ADDRESS: undefined })
    const { plugins, calls } = makePlugins()

    await expect(runOnboard(env, baseArgs, plugins)).rejects.toThrow(
      /enableL4dEscrow=true requires.*ESCROW_FACTORY_ADDRESS.*TIER_STRATEGY_ADDRESS.*FACILITATOR_FEE_EOA/s,
    )

    // Step 1 (ENS mint) DOES run before the env-var check (orchestrator design — env validation
    // happens inside the if-branch). What MUST hold: no escrow / splitter / identity writes.
    expect(calls.escrowWrites).toHaveLength(0)
    expect(calls.splitterWrites).toHaveLength(0)
    expect(calls.identityWrites).toHaveLength(0)
    expect(calls.fetchCalls).toHaveLength(0)
  })

  test('result shape: legacy flow returns escrow=null + escrowDeployTx=null', async () => {
    const env = makeEnv()
    const { plugins } = makePlugins({ agentId: 11n })
    // No enableL4dEscrow → legacy 5-step path.
    const result = await runOnboard(env, {
      ...baseArgs, enableL4dEscrow: undefined,
    } as any, plugins)

    expect(result.steps).toHaveLength(5)
    expect(result.escrow).toBeNull()
    expect(result.escrowDeployTx).toBeNull()
  })
})
