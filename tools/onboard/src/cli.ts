#!/usr/bin/env tsx
/**
 * Reckon402 L4c / L4d onboarding CLI.
 *
 * Usage (L4d 6-step / on-chain Escrow):
 *   tsx tools/onboard/src/cli.ts --name seller10.reckon402-test.eth \
 *     --seller-eoa 0xD53F... \
 *     --endpoint https://agent.reckon402.com/research \
 *     --amount 100000 \
 *     --enable-l4d-escrow
 *
 * Usage (legacy L4c 5-step):
 *   tsx tools/onboard/src/cli.ts --name seller9.reckon402-test.eth \
 *     --seller-eoa 0xD53F... \
 *     --endpoint https://agent.reckon402.com/research \
 *     --amount 100000 \
 *     [--recipients 0x...,0x...] [--bps 5000,5000]
 *
 * Env vars (all required unless noted):
 *   ETH_SEPOLIA_RPC_PRIMARY, BASE_SEPOLIA_RPC_PRIMARY
 *   ENS_FUNDER_PK, RECKON402_DEPLOYER_PK, RECKON402_ONBOARDING_PK
 *   SPLITTER_FACTORY_ADDRESS
 *   GATEWAY_BASE_URL      (default: https://gateway.reckon402.com)
 *   FACILITATOR_BASE_URL  (default: https://facilitator.reckon402.com)
 *
 * Required only when --enable-l4d-escrow is passed:
 *   ESCROW_FACTORY_ADDRESS, TIER_STRATEGY_ADDRESS, FACILITATOR_FEE_EOA
 */

import { runOnboard } from './orchestrator.js'
import type { OnboardEnv, OnboardStep } from './types.js'
import { IDENTITY_REGISTRY_BASE_SEPOLIA, PARENT_RESOLVER_ENS_SEPOLIA } from './types.js'

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) {
    console.error(`Missing required env var: ${key}`)
    process.exit(2)
  }
  return v
}

async function main() {
  const name       = getArg('--name')       ?? ''
  const sellerEoa  = (getArg('--seller-eoa') ?? '') as `0x${string}`
  const endpoint   = getArg('--endpoint')   ?? ''
  const amount     = getArg('--amount')     ?? ''
  const recipients = getArg('--recipients')?.split(',') as `0x${string}`[] | undefined
  const bps        = getArg('--bps')?.split(',').map(n => Number(n))
  const enableL4dEscrow = hasFlag('--enable-l4d-escrow')

  if (!name || !sellerEoa || !endpoint || !amount) {
    console.error('Usage: onboard --name <ens> --seller-eoa <0x..> --endpoint <url> --amount <wei> [--enable-l4d-escrow]')
    process.exit(2)
  }

  const parts = name.split('.')
  if (parts.length < 3) {
    console.error('Expected ENS name of form "label.reckon402-test.eth"')
    process.exit(2)
  }
  const label      = parts[0]!
  const parentName = parts.slice(1).join('.')

  const env: OnboardEnv = {
    ETH_SEPOLIA_RPC_PRIMARY:        requireEnv('ETH_SEPOLIA_RPC_PRIMARY'),
    BASE_SEPOLIA_RPC_PRIMARY:       requireEnv('BASE_SEPOLIA_RPC_PRIMARY'),
    ENS_FUNDER_PK:                  requireEnv('ENS_FUNDER_PK')               as `0x${string}`,
    RECKON402_DEPLOYER_PK:          requireEnv('RECKON402_DEPLOYER_PK')       as `0x${string}`,
    RECKON402_ONBOARDING_PK:        requireEnv('RECKON402_ONBOARDING_PK')     as `0x${string}`,
    SPLITTER_FACTORY_ADDRESS:       requireEnv('SPLITTER_FACTORY_ADDRESS')    as `0x${string}`,
    RECKON402_RESOLVER_SEPOLIA:     PARENT_RESOLVER_ENS_SEPOLIA,
    IDENTITY_REGISTRY_BASE_SEPOLIA: IDENTITY_REGISTRY_BASE_SEPOLIA,
    // L4d-only — required when --enable-l4d-escrow is set; the orchestrator
    // throws a clean error if missing in that mode.
    ESCROW_FACTORY_ADDRESS:         enableL4dEscrow
      ? (requireEnv('ESCROW_FACTORY_ADDRESS') as `0x${string}`)
      : (process.env.ESCROW_FACTORY_ADDRESS as `0x${string}` | undefined),
    TIER_STRATEGY_ADDRESS:          enableL4dEscrow
      ? (requireEnv('TIER_STRATEGY_ADDRESS')  as `0x${string}`)
      : (process.env.TIER_STRATEGY_ADDRESS  as `0x${string}` | undefined),
    FACILITATOR_FEE_EOA:            enableL4dEscrow
      ? (requireEnv('FACILITATOR_FEE_EOA')    as `0x${string}`)
      : (process.env.FACILITATOR_FEE_EOA    as `0x${string}` | undefined),
    GATEWAY_BASE_URL:               process.env.GATEWAY_BASE_URL      ?? 'https://gateway.reckon402.com',
    FACILITATOR_BASE_URL:           process.env.FACILITATOR_BASE_URL  ?? 'https://facilitator.reckon402.com',
    CHAIN_ID_BASE_SEPOLIA:          84532,
  }

  const progressSink = (step: OnboardStep) => {
    const status = step.error ? 'FAIL'
      : step.completedAt ? 'DONE'
      : 'START'
    const tx = step.txHash ? ` tx=${step.txHash}` : ''
    console.log(JSON.stringify({ ts: Date.now(), status, step: step.id, label: step.label, tx, note: step.note, error: step.error }))
  }

  try {
    const result = await runOnboard(env, {
      name, parentName, label, sellerEoa, endpoint, amount, recipients, bps, enableL4dEscrow,
      progressSink,
    })
    console.log(JSON.stringify({ ok: true, result: { ...result, agentId: result.agentId.toString() } }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2))
    process.exit(1)
  }
}

main()
