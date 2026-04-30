import { privateKeyToAccount } from 'viem/accounts'
import type { OnboardArgs, OnboardResult, OnboardStep, OnboardEnv, StepId } from './types.js'
import {
  mintSubname, transferSubnodeOwnership, makeMintSubnameClients,
  type MintSubnameClients,
} from './steps/mint-subname.js'
import {
  deploySplitter, makeDeploySplitterClients, type DeploySplitterClients,
} from './steps/deploy-splitter.js'
import {
  registerAgentId, makeRegisterAgentIdClients, type RegisterAgentIdClients,
} from './steps/register-agent-id.js'
import { setEnsRecords } from './steps/set-ens-records.js'
import { seedGateway } from './steps/seed-gateway.js'

export interface StepPlugins {
  // Overridable for tests — defaults construct real viem clients.
  makeEnsClients?:      (rpcUrl: string, pk: `0x${string}`) => MintSubnameClients
  makeSplitterClients?: (rpcUrl: string, pk: `0x${string}`) => DeploySplitterClients
  makeIdentityClients?: (rpcUrl: string, pk: `0x${string}`) => RegisterAgentIdClients
  fetchImpl?:           typeof fetch
}

/**
 * Orchestrate the 5-step onboarding flow. Each step emits a progress blob to
 * `args.progressSink`. If any step throws, the orchestrator records the error
 * on that step and rethrows — no rollback, no retry (per spec §3.7).
 */
export async function runOnboard(
  env: OnboardEnv,
  args: OnboardArgs,
  plugins: StepPlugins = {},
): Promise<OnboardResult> {
  const steps: OnboardStep[] = []
  const sink = args.progressSink ?? (() => {})

  const funderAccount = privateKeyToAccount(env.ENS_FUNDER_PK)
  const funderAddress = funderAccount.address as `0x${string}`

  const ensClients = (plugins.makeEnsClients ?? makeMintSubnameClients)(
    env.ETH_SEPOLIA_RPC_PRIMARY,
    env.ENS_FUNDER_PK,
  )
  const splitterClients = (plugins.makeSplitterClients ?? makeDeploySplitterClients)(
    env.BASE_SEPOLIA_RPC_PRIMARY,
    env.RECKON402_DEPLOYER_PK,
  )
  const identityClients = (plugins.makeIdentityClients ?? makeRegisterAgentIdClients)(
    env.BASE_SEPOLIA_RPC_PRIMARY,
    env.RECKON402_DEPLOYER_PK,
  )
  const deployerAddress = identityClients.wallet.account!.address as `0x${string}`

  const fetchImpl = plugins.fetchImpl ?? fetch

  const recipients = args.recipients ?? [args.sellerEoa]
  const bps        = args.bps        ?? [10_000]

  async function step<T>(
    id: StepId,
    label: string,
    fn: () => Promise<{ result: T; txHash?: `0x${string}`; externalLink?: string }>,
  ): Promise<T> {
    const blob: OnboardStep = { id, label, startedAt: Date.now() }
    steps.push(blob)
    await sink({ ...blob })
    try {
      const r = await fn()
      blob.completedAt = Date.now()
      if (r.txHash) blob.txHash = r.txHash
      if (r.externalLink) blob.externalLink = r.externalLink
      await sink({ ...blob })
      return r.result
    } catch (err) {
      blob.error = (err as Error).message
      blob.completedAt = Date.now()
      await sink({ ...blob })
      throw err
    }
  }

  // Step 1 — mint ENS subname (funder keeps ownership for bootstrap window)
  const mintRes = await step(1, 'Mint ENS subname', async () => {
    const r = await mintSubname(ensClients, {
      parentName: args.parentName,
      label:      args.label,
      sellerEoa:  args.sellerEoa,
      transferToSeller: false,
    }, funderAddress)
    return { result: r, txHash: r.subnameRegisterTx, externalLink: r.externalLink }
  })

  // Step 2 — deploy Splitter via factory
  const splitterRes = await step(2, 'Deploy Splitter via factory', async () => {
    const r = await deploySplitter(splitterClients, {
      factoryAddress: env.SPLITTER_FACTORY_ADDRESS,
      ensName:        args.name,
      sellerEoa:      args.sellerEoa,
      recipients,
      bps,
    })
    return {
      result: r,
      txHash: r.splitterDeployTx ?? undefined,
      externalLink: r.externalLink,
    }
  })

  // Step 3 — register ERC-8004 agentId
  const identityRes = await step(3, 'Register ERC-8004 agentId', async () => {
    const r = await registerAgentId(identityClients, {
      identityRegistry: env.IDENTITY_REGISTRY_BASE_SEPOLIA,
      tokenURI:         `${env.GATEWAY_BASE_URL}/agents/${encodeURIComponent(args.name)}/metadata.json`,
      deployerEoa:      deployerAddress,
      sellerEoa:        args.sellerEoa,
    })
    return { result: r, txHash: r.agentRegisterTx, externalLink: r.externalLink }
  })

  // Step 4 — set ENS records via gateway /admin/bootstrap (signed by onboarding key)
  const records: Record<string, string> = {
    'x402.splitter':         splitterRes.splitter,
    'x402.facilitator':      env.FACILITATOR_BASE_URL,
    'x402.erc8004.registry': `eip155:${env.CHAIN_ID_BASE_SEPOLIA}:${env.IDENTITY_REGISTRY_BASE_SEPOLIA}`,
    'x402.erc8004.agent_id': identityRes.agentId.toString(),
    'x402.endpoint':         args.endpoint,
    'x402.amount':           args.amount,
    'x402.pricing':          JSON.stringify({ discount_bps: 0 }),
    'x402.asset':            `eip155:${env.CHAIN_ID_BASE_SEPOLIA}/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e`,
    'x402.scheme':           'eip3009',
    'x402.version':          '2',
    'x402.attestation':      'on',
    'x402.yield':            'none',
  }
  await step(4, 'Set ENS records (gateway bootstrap)', async () => {
    const r = await setEnsRecords({
      gatewayBaseUrl: env.GATEWAY_BASE_URL,
      ensName:        args.name,
      records,
      onboardingPk:   env.RECKON402_ONBOARDING_PK,
    }, { fetch: fetchImpl })
    return { result: r, externalLink: r.externalLink }
  })

  // Step 5 — seed gateway agent_id_index + final subnode transfer
  await step(5, 'Seed gateway + transfer ENS ownership', async () => {
    await seedGateway({
      gatewayBaseUrl: env.GATEWAY_BASE_URL,
      ensName:        args.name,
      chainId:        env.CHAIN_ID_BASE_SEPOLIA,
      agentId:        identityRes.agentId,
      records,
      onboardingPk:   env.RECKON402_ONBOARDING_PK,
    }, { fetch: fetchImpl })

    // Final ownership transfer to the seller — closes the bootstrap window.
    const transferTx = await transferSubnodeOwnership(
      ensClients,
      mintRes.subnode,
      args.sellerEoa,
    )
    return {
      result: { transferTx },
      txHash: transferTx,
      externalLink: `https://sepolia.etherscan.io/tx/${transferTx}`,
    }
  })

  // Last transferTx was captured but not returned from step() generically.
  // Recover from the last step blob.
  const lastStep = steps[steps.length - 1]
  const finalTransferTx = (lastStep?.txHash ?? null) as `0x${string}` | null

  return {
    ensName:                args.name,
    sellerEoa:              args.sellerEoa,
    agentId:                identityRes.agentId,
    splitter:               splitterRes.splitter,
    splitterDeployTx:       splitterRes.splitterDeployTx,
    subnameRegisterTx:      mintRes.subnameRegisterTx,
    subnameOwnerTransferTx: finalTransferTx,
    agentRegisterTx:        identityRes.agentRegisterTx,
    agentTransferTx:        identityRes.agentTransferTx,
    steps,
  }
}
