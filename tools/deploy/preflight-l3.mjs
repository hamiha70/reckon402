#!/usr/bin/env node
/**
 * preflight-l3.mjs — pre-deploy probe for L3 commit 6.
 *
 * Catches the three silent-fail modes that would otherwise burn gas or
 * deploy a broken worker:
 *
 *  1. KMS sign probe: derives the deployer EOA via kmsAccount, signs a
 *     throwaway message, recovers the signer, and asserts it matches
 *     the locked address in AGENTS.md. If KMS misbehaves, we find out
 *     here — not mid-broadcast of a contract-creation tx.
 *
 *  2. FACILITATOR_PK identity probe: derives the EOA from the private
 *     key currently in env, asserts it matches the locked facilitator
 *     address. If the PK got rotated and now derives to a different
 *     address, the worker would submit settlement txs from a mystery
 *     EOA — caught here before any wrangler secret put.
 *
 *  3. Balance probe: both deployer and facilitator EOAs must be ≥
 *     0.01 ETH on Base Sepolia. Below the floor = silent tx failures
 *     at first settle.
 *
 *  4. RPC reachability probe (primary + fallback): both must return a
 *     fresh block number within 5s. A broken RPC setting is the most
 *     common live-deploy failure.
 *
 * Exit codes:
 *   0 — all probes green, safe to proceed with steps 2-10 of deploy-l3.md
 *   1 — at least one probe failed; DO NOT deploy, read stderr
 *
 * Usage:
 *   infisical run --env dev --domain https://secrets.intentralabs.com -- bash -c '
 *     export AWS_ACCESS_KEY_ID="$DEPLOYER_AWS_ACCESS_KEY_ID"
 *     export AWS_SECRET_ACCESS_KEY="$DEPLOYER_AWS_SECRET_ACCESS_KEY"
 *     export AWS_REGION="eu-central-1"
 *     unset AWS_PROFILE
 *     node tools/deploy/preflight-l3.mjs
 *   '
 */

import { createPublicClient, http, verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { kmsAccount } from '../sign/kms-account.mjs'

const DEPLOYER_EOA    = '0x66c2858d9a8605957c516a77262eb66ee6be113c'
const FACILITATOR_EOA = '0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455'
const KEY_ALIAS       = 'alias/reckon402/mainnet/deployer/evm'
const MIN_WEI         = 10n ** 16n // 0.01 ETH

let pass = 0
let fail = 0
function green(name, detail = '') {
  pass += 1
  console.error(`  PASS  ${name}${detail ? ' — ' + detail : ''}`)
}
function red(name, reason) {
  fail += 1
  console.error(`  FAIL  ${name} — ${reason}`)
}

async function probeRpc(label, url) {
  if (!url) return red(`${label} RPC`, 'env var unset')
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(url) })
    const block = await Promise.race([
      client.getBlockNumber(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('5s timeout')), 5_000)),
    ])
    green(`${label} RPC`, `block=${block}`)
    return client
  } catch (err) {
    red(`${label} RPC`, err.message)
    return null
  }
}

async function probeBalance(client, label, expectedAddress) {
  if (!client) return red(`${label} balance`, 'no RPC client available')
  try {
    const bal = await client.getBalance({ address: expectedAddress })
    const eth = Number(bal) / 1e18
    if (bal < MIN_WEI) {
      red(`${label} balance`, `below floor: ${eth} ETH (need ≥ 0.01)`)
    } else {
      green(`${label} balance`, `${eth} ETH on Base Sepolia`)
    }
  } catch (err) {
    red(`${label} balance`, err.message)
  }
}

async function probeKmsDeployer() {
  try {
    const acct = await kmsAccount({ keyAlias: KEY_ALIAS })
    if (acct.address.toLowerCase() !== DEPLOYER_EOA.toLowerCase()) {
      red('KMS deployer identity', `derived=${acct.address} expected=${DEPLOYER_EOA}`)
      return null
    }
    green('KMS deployer identity', `address=${acct.address}`)

    // Sign + recover probe — exercises the full KMS → viem bridge.
    const probeMessage = 'reckon402-preflight-' + Date.now()
    const signature = await acct.signMessage({ message: probeMessage })
    const ok = await verifyMessage({
      address: acct.address,
      message: probeMessage,
      signature,
    })
    if (!ok) {
      red('KMS sign/recover probe', 'verifyMessage returned false')
      return null
    }
    green('KMS sign/recover probe', 'message signed + recovered')
    return acct
  } catch (err) {
    red('KMS deployer identity / sign probe', err.message)
    return null
  }
}

function probeFacilitatorPk() {
  const pk = process.env.FACILITATOR_PK
  if (!pk) {
    red('FACILITATOR_PK identity', 'env var unset (hydrate via infisical)')
    return null
  }
  try {
    const account = privateKeyToAccount(pk)
    if (account.address.toLowerCase() !== FACILITATOR_EOA.toLowerCase()) {
      red('FACILITATOR_PK identity',
        `derives to ${account.address}; expected ${FACILITATOR_EOA}. DO NOT deploy — the PK has drifted from AGENTS.md.`)
      return null
    }
    green('FACILITATOR_PK identity', `derives to ${account.address}`)
    return account
  } catch (err) {
    red('FACILITATOR_PK identity', err.message)
    return null
  }
}

async function main() {
  console.error('=== L3 deploy preflight ===')
  console.error('')

  const primaryUrl  = process.env.BASE_SEPOLIA_RPC_PRIMARY
  const fallbackUrl = process.env.BASE_SEPOLIA_RPC_FALLBACK

  // Reachability first — everything else depends on it.
  const primary  = await probeRpc('primary',  primaryUrl)
  const fallback = await probeRpc('fallback', fallbackUrl)

  // Identity + sign probe for the KMS deployer.
  await probeKmsDeployer()

  // Identity probe for the facilitator software-custody PK.
  probeFacilitatorPk()

  // Balance probes (use primary RPC; fall back to fallback if primary red).
  const balClient = primary ?? fallback
  await probeBalance(balClient, 'Deployer',    DEPLOYER_EOA)
  await probeBalance(balClient, 'Facilitator', FACILITATOR_EOA)

  console.error('')
  console.error(`=== ${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} pass, ${fail} fail ===`)
  if (fail > 0) {
    console.error('DO NOT proceed with deploy. Fix the failing probe(s) and re-run.')
    process.exit(1)
  }
  console.error('Preflight green — safe to proceed with steps 2-10 of tools/deploy/deploy-l3.md.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
