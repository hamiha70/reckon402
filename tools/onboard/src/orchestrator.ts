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
import {
  deployEscrow, makeDeployEscrowClients, type DeployEscrowClients,
} from './steps/deploy-escrow.js'
import { setEnsRecords } from './steps/set-ens-records.js'
import { seedGateway } from './steps/seed-gateway.js'

export interface StepPlugins {
  // Overridable for tests — defaults construct real viem clients.
  makeEnsClients?:      (rpcUrl: string, pk: `0x${string}`) => MintSubnameClients
  makeSplitterClients?: (rpcUrl: string, pk: `0x${string}`) => DeploySplitterClients
  makeIdentityClients?: (rpcUrl: string, pk: `0x${string}`) => RegisterAgentIdClients
  makeEscrowClients?:   (rpcUrl: string, pk: `0x${string}`) => DeployEscrowClients
  fetchImpl?:           typeof fetch
}

// L4d on-chain Escrow constants — pinned per AGENTS.md "L4b framing lock"
// + the L4d feedback-tag convention. The orchestrator passes these to
// every Escrow it deploys in v1; future versions may make them per-agent.
const L4D_ATTESTATION_TAG1 = 'payment'
const L4D_ATTESTATION_TAG2 = 'x402-settlement'

// L4d 3-way Splitter BPS — locked at the L4d-pre-onchain-baseline -> L4d
// economic-model rewrite. Sums to 10_000.
const L4D_SELLER_BPS          = 8700
const L4D_FACILITATOR_FEE_BPS = 300
const L4D_ESCROW_BPS          = 1000

/**
 * Orchestrate the onboarding flow. The flow shape depends on
 * `args.enableL4dEscrow`:
 *
 * - `false` / unset (legacy):
 *     1. Mint ENS subname
 *     2. Deploy Splitter via factory
 *     3. Register ERC-8004 agentId
 *     4. Set ENS records (gateway bootstrap)
 *     5. Seed gateway + transfer ENS ownership
 *
 * - `true` (L4d on-chain Escrow path):
 *     1. Mint ENS subname
 *     2. Register ERC-8004 agentId            <-- moved up from legacy step 3
 *     3. Deploy Escrow via factory             <-- NEW
 *     4. Deploy Splitter via factory           <-- 3-recipient: [seller, facilitator-fee, escrow]
 *     5. Set ENS records (gateway bootstrap)   <-- now includes x402.escrow
 *     6. Seed gateway + transfer ENS ownership
 *
 * If any step throws, the orchestrator records the error on that step and
 * rethrows — no rollback, no retry (per spec §3.7).
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
    env.RECKON402_ONBOARDING_PK,
  )
  const deployerAddress = identityClients.wallet.account!.address as `0x${string}`

  const fetchImpl = plugins.fetchImpl ?? fetch

  async function step<T>(
    id: StepId,
    label: string,
    fn: () => Promise<{ result: T; txHash?: `0x${string}`; externalLink?: string; note?: string }>,
  ): Promise<T> {
    const blob: OnboardStep = { id, label, startedAt: Date.now() }
    steps.push(blob)
    await sink({ ...blob })
    try {
      const r = await fn()
      blob.completedAt = Date.now()
      if (r.txHash) blob.txHash = r.txHash
      if (r.externalLink) blob.externalLink = r.externalLink
      if (r.note) blob.note = r.note
      await sink({ ...blob })
      return r.result
    } catch (err) {
      blob.error = (err as Error).message
      blob.completedAt = Date.now()
      await sink({ ...blob })
      throw err
    }
  }

  // Step 1 — mint ENS subname (funder keeps ownership for bootstrap window).
  // Same in both flows.
  const mintRes = await step(1, 'Mint ENS subname', async () => {
    const r = await mintSubname(ensClients, {
      parentName: args.parentName,
      label:      args.label,
      sellerEoa:  args.sellerEoa,
      transferToSeller: false,
    }, funderAddress)
    return {
      result: r,
      txHash: r.subnameRegisterTx,
      externalLink: r.externalLink,
      note: `subname=${args.name}`,
    }
  })

  if (args.enableL4dEscrow) {
    // ─── L4d 6-step on-chain-Escrow flow ──────────────────────────────────
    if (!env.ESCROW_FACTORY_ADDRESS || !env.TIER_STRATEGY_ADDRESS || !env.FACILITATOR_FEE_EOA) {
      throw new Error(
        'enableL4dEscrow=true requires env.ESCROW_FACTORY_ADDRESS, ' +
        'env.TIER_STRATEGY_ADDRESS, and env.FACILITATOR_FEE_EOA. ' +
        'Update the orchestrator worker wrangler.toml [vars] block.',
      )
    }

    const escrowClients = (plugins.makeEscrowClients ?? makeDeployEscrowClients)(
      env.BASE_SEPOLIA_RPC_PRIMARY,
      env.RECKON402_DEPLOYER_PK,
    )

    // Step 2 (L4d) — register ERC-8004 agentId BEFORE Escrow + Splitter so
    // we have agentId for the Escrow's CREATE2 prediction.
    const identityRes = await step(2, 'Register ERC-8004 agentId', async () => {
      const r = await registerAgentId(identityClients, {
        identityRegistry: env.IDENTITY_REGISTRY_BASE_SEPOLIA,
        tokenURI:         `${env.GATEWAY_BASE_URL}/agents/${encodeURIComponent(args.name)}/metadata.json`,
        deployerEoa:      deployerAddress,
        sellerEoa:        args.sellerEoa,
      })
      return {
        result:       r,
        txHash:       r.agentRegisterTx,
        externalLink: r.externalLink,
        note:         `agentId=${r.agentId}`,
      }
    })

    // Step 3 (L4d) — deploy per-agent Escrow at a deterministic CREATE2
    // address derived from (agentId, facilitatorClient, tierStrategy,
    // tag1, tag2, salt=keccak256(ensName)).
    const escrowRes = await step(3, 'Deploy Escrow via factory', async () => {
      const r = await deployEscrow(escrowClients, {
        factoryAddress:    env.ESCROW_FACTORY_ADDRESS!,
        ensName:           args.name,
        agentId:           identityRes.agentId,
        facilitatorClient: env.FACILITATOR_FEE_EOA!,
        tierStrategy:      env.TIER_STRATEGY_ADDRESS!,
        tag1:              L4D_ATTESTATION_TAG1,
        tag2:              L4D_ATTESTATION_TAG2,
      })
      return {
        result:       r,
        txHash:       r.escrowDeployTx ?? undefined,
        externalLink: r.externalLink,
        note:         `escrow=${r.escrow}`,
      }
    })

    // Step 4 (L4d) — deploy Splitter with 3 recipients:
    //   [0] seller             (where the agent's revenue lands)
    //   [1] facilitator-fee    (Reckon402 fee EOA)
    //   [2] escrow             (drips out via the tier ramp)
    //
    // BPS defaults are the canonical L4d triple [8700, 300, 1000]
    // (87/3/10), but operators can override via args.bps for new agents.
    // The Splitter constructor enforces sum == 10_000 — we sanity-check
    // here so the failure message is friendly instead of a low-level revert.
    const l4dRecipients: `0x${string}`[] = [
      args.sellerEoa,
      env.FACILITATOR_FEE_EOA!,
      escrowRes.escrow,
    ]
    let l4dBps = [L4D_SELLER_BPS, L4D_FACILITATOR_FEE_BPS, L4D_ESCROW_BPS]
    if (args.bps && args.bps.length > 0) {
      if (args.bps.length !== 3) {
        throw new Error(
          `--enable-l4d-escrow expects --bps to have exactly 3 values (seller, facilitator-fee, escrow). got ${args.bps.length}`,
        )
      }
      const sum = args.bps.reduce((a, b) => a + b, 0)
      if (sum !== 10_000) {
        throw new Error(
          `--bps must sum to 10000 basis points. got [${args.bps.join(',')}] = ${sum}`,
        )
      }
      l4dBps = [...args.bps]
    }

    const splitterRes = await step(4, 'Deploy Splitter via factory', async () => {
      const r = await deploySplitter(splitterClients, {
        factoryAddress: env.SPLITTER_FACTORY_ADDRESS,
        ensName:        args.name,
        sellerEoa:      args.sellerEoa,
        recipients:     l4dRecipients,
        bps:            l4dBps,
      })
      return {
        result:       r,
        txHash:       r.splitterDeployTx ?? undefined,
        externalLink: r.externalLink,
        note:         `splitter=${r.splitter}`,
      }
    })

    // Step 5 (L4d) — ENS records (now includes x402.escrow).
    const records: Record<string, string> = {
      'x402.splitter':         splitterRes.splitter,
      'x402.escrow':           escrowRes.escrow,
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
    await step(5, 'Set ENS records (gateway bootstrap)', async () => {
      const r = await setEnsRecords({
        gatewayBaseUrl: env.GATEWAY_BASE_URL,
        ensName:        args.name,
        records,
        onboardingPk:   env.RECKON402_ONBOARDING_PK,
      }, { fetch: fetchImpl })
      return {
        result:       r,
        externalLink: r.externalLink,
        note:         `records=${Object.keys(records).length}`,
      }
    })

    // Step 6 (L4d) — seed gateway agent_id_index + final subnode transfer.
    await step(6, 'Seed gateway + transfer ENS ownership', async () => {
      await seedGateway({
        gatewayBaseUrl: env.GATEWAY_BASE_URL,
        ensName:        args.name,
        chainId:        env.CHAIN_ID_BASE_SEPOLIA,
        agentId:        identityRes.agentId,
        records,
        onboardingPk:   env.RECKON402_ONBOARDING_PK,
      }, { fetch: fetchImpl })

      const transferTx = await transferSubnodeOwnership(
        ensClients,
        mintRes.subnode,
        args.sellerEoa,
      )
      return {
        result: { transferTx },
        txHash: transferTx,
        externalLink: `https://sepolia.etherscan.io/tx/${transferTx}`,
        note: 'owner=seller',
      }
    })

    const lastStep = steps[steps.length - 1]
    const finalTransferTx = (lastStep?.txHash ?? null) as `0x${string}` | null

    return {
      ensName:                args.name,
      sellerEoa:              args.sellerEoa,
      agentId:                identityRes.agentId,
      splitter:               splitterRes.splitter,
      splitterDeployTx:       splitterRes.splitterDeployTx,
      escrow:                 escrowRes.escrow,
      escrowDeployTx:         escrowRes.escrowDeployTx,
      subnameRegisterTx:      mintRes.subnameRegisterTx,
      subnameOwnerTransferTx: finalTransferTx,
      agentRegisterTx:        identityRes.agentRegisterTx,
      agentTransferTx:        identityRes.agentTransferTx,
      steps,
    }
  }

  // ─── Legacy 5-step flow (seller9-compatible) ──────────────────────────────

  const recipients = args.recipients ?? [args.sellerEoa]
  const bps        = args.bps        ?? [10_000]

  // Match the L4d-side guard so legacy custom-bps paths fail fast with a
  // friendly error instead of a low-level Splitter constructor revert.
  if (recipients.length !== bps.length) {
    throw new Error(
      `--recipients and --bps must have the same length. got ${recipients.length} vs ${bps.length}`,
    )
  }
  const legacySumBps = bps.reduce((a, b) => a + b, 0)
  if (legacySumBps !== 10_000) {
    throw new Error(
      `--bps must sum to 10000 basis points. got [${bps.join(',')}] = ${legacySumBps}`,
    )
  }

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
      note: `splitter=${r.splitter}`,
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
    return {
      result:       r,
      txHash:       r.agentRegisterTx,
      externalLink: r.externalLink,
      note:         `agentId=${r.agentId}`,
    }
  })

  // Step 4 — set ENS records via gateway /admin/bootstrap
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
    return {
      result: r,
      externalLink: r.externalLink,
      note: `records=${Object.keys(records).length}`,
    }
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

    const transferTx = await transferSubnodeOwnership(
      ensClients,
      mintRes.subnode,
      args.sellerEoa,
    )
    return {
      result: { transferTx },
      txHash: transferTx,
      externalLink: `https://sepolia.etherscan.io/tx/${transferTx}`,
      note: 'owner=seller',
    }
  })

  const lastStep = steps[steps.length - 1]
  const finalTransferTx = (lastStep?.txHash ?? null) as `0x${string}` | null

  return {
    ensName:                args.name,
    sellerEoa:              args.sellerEoa,
    agentId:                identityRes.agentId,
    splitter:               splitterRes.splitter,
    splitterDeployTx:       splitterRes.splitterDeployTx,
    escrow:                 null,                  // legacy flow does NOT deploy an escrow
    escrowDeployTx:         null,
    subnameRegisterTx:      mintRes.subnameRegisterTx,
    subnameOwnerTransferTx: finalTransferTx,
    agentRegisterTx:        identityRes.agentRegisterTx,
    agentTransferTx:        identityRes.agentTransferTx,
    steps,
  }
}
