import { createPublicClient, createWalletClient, http, keccak256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import type { D1Database } from '@cloudflare/workers-types'
import { reputation } from '@reckon402/erc-8004-client'
import { makeLogger } from '@reckon402/logger'
import { resolveAgentId } from './agent-resolver.js'
import type { ResolvedSplitter } from './splitter-resolver.js'
import { invalidateGatewayCache } from './cache-invalidate.js'

const log = makeLogger('attestation')

/**
 * L4b₁ — ERC-8004 settlement-attestation write (DXb rail).
 *
 * Called via ctx.waitUntil() from settle-route.ts after the CONFIRMED
 * transition. Fire-and-forget: success writes a
 * `(payment, x402-settlement)` attestation to ReputationRegistry,
 * records the tx in D1, and invalidates the gateway cache; failure
 * is logged and recorded but never propagates to the payment
 * response.
 *
 * See specs/07-l4b-erc8004-writes.md §5 for the full guard order and
 * args contract. specs/06-actor-act-matrix.md for the facilitator-as-
 * clientAddress (D3) rationale.
 */
export interface AttestationEnv {
  DB: D1Database
  FACILITATOR_PK: string
  BASE_SEPOLIA_RPC_PRIMARY: string
  SPLITTER_ADDRESS: string
  ENABLE_ERC8004_WRITES: string
  ERC8004_CHAIN_ID: string
  SELLER_AGENT_IDS: string
  /** L4c: "true" keeps legacy JSON-map resolver alive; "false" = factory-only. */
  USE_LEGACY_AGENT_RESOLVER?: string
  GATEWAY_CACHE_HOOK_URL: string
  GATEWAY_CACHE_HOOK_TOKEN?: string
  ATTESTATION_FEEDBACK_URI_PREFIX: string
}

export interface AttestationInput {
  paymentId: `0x${string}`
  transferTx: `0x${string}`
  distributeTx: `0x${string}`
  authValue: string
  /**
   * L4c: caller (settle-route) threads the gateway-resolved
   * `{splitter, agentId, ensName}` here. When present, the attestation
   * path uses `resolved.agentId` directly and never consults
   * SELLER_AGENT_IDS.
   */
  resolved?: ResolvedSplitter | null
}

const FEEDBACK_TAG_1 = 'payment'
const FEEDBACK_TAG_2 = 'x402-settlement'
const FEEDBACK_ENDPOINT = 'https://facilitator.reckon402.com/x402/settle'
const FEEDBACK_VALUE = 1n
const FEEDBACK_DECIMALS = 0

export async function maybeWriteAttestation(
  env: AttestationEnv,
  input: AttestationInput,
): Promise<void> {
  // Guard 1: master flag.
  if (env.ENABLE_ERC8004_WRITES !== 'true') return

  // Guard 2: chainId parse.
  const chainId = Number(env.ERC8004_CHAIN_ID)
  if (!Number.isFinite(chainId) || !Number.isInteger(chainId) || chainId <= 0) {
    log.error('config_invalid_chain_id', {
      raw: env.ERC8004_CHAIN_ID,
    })
    return
  }

  // Guard 3: agent resolution.
  //
  // L4c: if `input.resolved` is present we trust its agentId verbatim
  // (already validated via gateway + factory `isDeployed`) and the
  // legacy JSON-map resolver is NEVER consulted. L4b₁ legacy falls back
  // to the JSON-map path iff USE_LEGACY_AGENT_RESOLVER="true". The
  // decision is inlined here (rather than delegated to a facade in
  // agent-resolver.ts) so module-level mocks of `resolveAgentId` take
  // effect reliably under ESM — a cross-module call wouldn't.
  let agentId: bigint | null
  if (input.resolved) {
    agentId = input.resolved.agentId
  } else if (env.USE_LEGACY_AGENT_RESOLVER !== 'true') {
    return
  } else {
    agentId = await resolveAgentId({
      SPLITTER_ADDRESS: env.SPLITTER_ADDRESS,
      BASE_SEPOLIA_RPC_PRIMARY: env.BASE_SEPOLIA_RPC_PRIMARY,
      SELLER_AGENT_IDS: env.SELLER_AGENT_IDS,
    })
  }
  if (agentId === null) return

  // Guard 4: idempotency.
  const existing = await env.DB
    .prepare(`SELECT 1 AS hit FROM attestations WHERE payment_id = ?1 AND agent_id = ?2`)
    .bind(input.paymentId, Number(agentId))
    .first<{ hit: number }>()
  if (existing) return

  // Happy path — build viem clients, compute feedback fields, call giveFeedback.
  const feedbackURI = `${env.ATTESTATION_FEEDBACK_URI_PREFIX}${input.paymentId}`
  const feedbackHash = keccak256(
    toHex(
      JSON.stringify({
        paymentId: input.paymentId,
        transferTx: input.transferTx,
        distributeTx: input.distributeTx,
        authValue: input.authValue,
      }),
    ),
  )

  const account = privateKeyToAccount(env.FACILITATOR_PK as Hex)
  const transport = http(env.BASE_SEPOLIA_RPC_PRIMARY)
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  // Allow the distribute tx to propagate through all Alchemy nodes before
  // fetching the nonce for the attestation write.  Without this delay the
  // auto-nonce fetch returns the distribute nonce (still pending) and the
  // attestation is rejected as "replacement transaction underpriced".
  // 3s is sufficient: Base Sepolia blocks are ~2s, and distribute is already
  // confirmed by the time ctx.waitUntil fires (settle confirmed before return).
  await new Promise(r => setTimeout(r, 3000))

  let tx: Hex
  try {
    tx = await reputation.giveFeedback({
      chainId,
      walletClient,
      agentId,
      value: FEEDBACK_VALUE,
      valueDecimals: FEEDBACK_DECIMALS,
      tag1: FEEDBACK_TAG_1,
      tag2: FEEDBACK_TAG_2,
      endpoint: FEEDBACK_ENDPOINT,
      feedbackURI,
      feedbackHash,
    })
  } catch (err) {
    const detail = truncate((err as Error).message ?? String(err), 500)
    log.error('giveFeedback_failed', detail)
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO attestations (
          payment_id, agent_id, reputation_tx, written_at,
          feedback_tag1, feedback_tag2, feedback_value, feedback_decimals,
          failure_detail
        ) VALUES (?1, ?2, 'FAILED', ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        input.paymentId,
        Number(agentId),
        Date.now(),
        FEEDBACK_TAG_1,
        FEEDBACK_TAG_2,
        Number(FEEDBACK_VALUE),
        FEEDBACK_DECIMALS,
        detail,
      )
      .run()
    return
  }

  // Wait for receipt — only persist SUCCESS on a successful on-chain receipt.
  let receipt
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: tx,
      timeout: 60_000,
      pollingInterval: 2000,
    })
  } catch (err) {
    const detail = truncate(
      `wait_receipt_timeout: ${(err as Error).message ?? String(err)}`,
      500,
    )
    log.error('attestation_receipt_timeout', { tx, detail })
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO attestations (
          payment_id, agent_id, reputation_tx, written_at,
          feedback_tag1, feedback_tag2, feedback_value, feedback_decimals,
          failure_detail
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        input.paymentId,
        Number(agentId),
        tx,
        Date.now(),
        FEEDBACK_TAG_1,
        FEEDBACK_TAG_2,
        Number(FEEDBACK_VALUE),
        FEEDBACK_DECIMALS,
        detail,
      )
      .run()
    return
  }

  if (receipt.status !== 'success') {
    const detail = `reverted_at_block_${receipt.blockNumber}`
    log.error('attestation_reverted', { tx, detail })
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO attestations (
          payment_id, agent_id, reputation_tx, written_at,
          feedback_tag1, feedback_tag2, feedback_value, feedback_decimals,
          failure_detail
        ) VALUES (?1, ?2, 'FAILED', ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        input.paymentId,
        Number(agentId),
        Date.now(),
        FEEDBACK_TAG_1,
        FEEDBACK_TAG_2,
        Number(FEEDBACK_VALUE),
        FEEDBACK_DECIMALS,
        detail,
      )
      .run()
    return
  }

  // SUCCESS: record attestation row + update receipts.td_erc8004_tx.
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO attestations (
        payment_id, agent_id, reputation_tx, written_at,
        feedback_tag1, feedback_tag2, feedback_value, feedback_decimals
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      input.paymentId,
      Number(agentId),
      tx,
      Date.now(),
      FEEDBACK_TAG_1,
      FEEDBACK_TAG_2,
      Number(FEEDBACK_VALUE),
      FEEDBACK_DECIMALS,
    )
    .run()

  await env.DB
    .prepare(`UPDATE receipts SET td_erc8004_tx = ?2 WHERE payment_id = ?1`)
    .bind(input.paymentId, tx)
    .run()

  // Fire-and-forget cache invalidation — don't let a hook failure mask success.
  await invalidateGatewayCache(
    {
      GATEWAY_CACHE_HOOK_URL: env.GATEWAY_CACHE_HOOK_URL,
      GATEWAY_CACHE_HOOK_TOKEN: env.GATEWAY_CACHE_HOOK_TOKEN,
    },
    { chainId, agentId },
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
