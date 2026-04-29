import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import type { EIP3009Authorization } from '@reckon402/types'
import { makeLogger } from '@reckon402/logger'
import { USDC_ABI } from './abi/usdc.js'
import { SPLITTER_ABI } from './abi/splitter.js'
import { splitSignature } from './eip3009.js'

const log = makeLogger('settle')

/**
 * Two-tx settlement per design pack 02_facilitator.md §7 + spec 04 §3.4:
 *   1) USDC.transferWithAuthorization (buyer -> Splitter)
 *   2) Splitter.distribute(paymentId, amount) -> recipients
 *
 * Both txs signed by the facilitator EOA (software custody; PK in Infisical
 * as FACILITATOR_PK). Chain-aware receipt poll per §8 (Base = 2s/block,
 * 60s max wait).
 */
export interface SettleEnv {
  FACILITATOR_PK: string
  USDC_ADDRESS: string
  SPLITTER_ADDRESS: string
  BASE_SEPOLIA_RPC_PRIMARY: string
  BASE_SEPOLIA_RPC_FALLBACK?: string
}

export interface SettleInput {
  authorization: EIP3009Authorization
  signature: Hex
  paymentId: Hex
}

export type SettleOutcome =
  | {
      success: true
      transferTx: Hex
      distributeTx: Hex
      blockNumber: bigint
      blockTimestamp: bigint
      gasUsed: bigint
    }
  | {
      success: false
      transferTx?: Hex
      distributeTx?: Hex
      failureReason: 'TX_REVERTED' | 'DEADLINE_EXCEEDED' | 'OTHER'
      failureDetail: string
    }

function makeClients(env: SettleEnv) {
  const account = privateKeyToAccount(env.FACILITATOR_PK as Hex)
  const transport = http(env.BASE_SEPOLIA_RPC_PRIMARY)
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })
  return { account, publicClient, walletClient }
}

/**
 * Submit both settlement txs and wait for receipts. On any failure,
 * returns a structured outcome with the reason; never throws for
 * expected on-chain failure modes.
 */
export async function settleOnChain(env: SettleEnv, input: SettleInput): Promise<SettleOutcome> {
  const { authorization, signature, paymentId } = input
  const { account, publicClient, walletClient } = makeClients(env)

  // Deadline pre-check — cheap guard before spending gas.
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec >= Number(authorization.validBefore)) {
    return {
      success: false,
      failureReason: 'DEADLINE_EXCEEDED',
      failureDetail: `now=${nowSec} >= validBefore=${authorization.validBefore}`,
    }
  }

  // Pre-fetch nonce once to avoid a read-after-write race on distributed RPC
  // providers (e.g. Alchemy load-balancers). Without this, the second
  // writeContract call (distribute) can read a stale nonce that equals the
  // transfer nonce and be rejected as "replacement transaction underpriced".
  const baseNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  })
  log.info('nonce_fetched', { paymentId, baseNonce, facilitator: account.address })

  let transferTx: Hex
  try {
    const { v, r, s } = splitSignature(signature)
    transferTx = await walletClient.writeContract({
      address: env.USDC_ADDRESS as Hex,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        authorization.from as Hex,
        authorization.to as Hex,
        BigInt(authorization.value),
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce as Hex,
        v, r, s,
      ],
      nonce: baseNonce,
    })
  } catch (err) {
    const detail = `transferWithAuthorization_submit_failed: ${(err as Error).message}`
    log.error('transfer_submit_failed', { paymentId, detail })
    return { success: false, failureReason: 'OTHER', failureDetail: detail }
  }
  log.info('transfer_submitted', { paymentId, tx: transferTx, nonce: baseNonce })

  let transferReceipt
  try {
    transferReceipt = await publicClient.waitForTransactionReceipt({
      hash: transferTx,
      timeout: 60_000,
      pollingInterval: 2000,
      confirmations: 1,
    })
  } catch (err) {
    const detail = `transfer_receipt_timeout: ${(err as Error).message}`
    log.error('transfer_timeout', { paymentId, detail })
    return { success: false, transferTx, failureReason: 'OTHER', failureDetail: detail }
  }
  log.info('transfer_confirmed', { paymentId, block: String(transferReceipt.blockNumber) })

  if (transferReceipt.status !== 'success') {
    return {
      success: false,
      transferTx,
      failureReason: 'TX_REVERTED',
      failureDetail: `transferWithAuthorization reverted at block ${transferReceipt.blockNumber}`,
    }
  }

  // Poll until the Splitter balance reflects the transfer before submitting
  // distribute — guards against load-balanced RPC nodes that haven't yet
  // propagated the confirmed transfer block.
  const expectedAmount = BigInt(authorization.value)
  const POLL_INTERVAL_MS = 1000
  const POLL_TIMEOUT_MS = 30_000
  const pollStart = Date.now()
  while (true) {
    const bal = await publicClient.readContract({
      address: env.USDC_ADDRESS as Hex,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [env.SPLITTER_ADDRESS as Hex],
    }) as bigint
    if (bal >= expectedAmount) break
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      return {
        success: false,
        transferTx,
        failureReason: 'OTHER',
        failureDetail: `splitter_balance_not_reflecting: bal=${bal} expected>=${expectedAmount} after ${POLL_TIMEOUT_MS}ms`,
      }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  let distributeTx: Hex
  try {
    // Explicit gas avoids eth_estimateGas which can hit a stale RPC node
    // and see InsufficientBalance even after the balance poll passed.
    // 300_000 is conservative upper-bound for 8 recipients × ~30k each.
    distributeTx = await walletClient.writeContract({
      address: env.SPLITTER_ADDRESS as Hex,
      abi: SPLITTER_ABI,
      functionName: 'distribute',
      args: [paymentId, BigInt(authorization.value)],
      gas: 300_000n,
      nonce: baseNonce + 1,
    })
  } catch (err) {
    const detail = `distribute_submit_failed: ${(err as Error).message}`
    log.error('distribute_submit_failed', { paymentId, detail })
    return { success: false, transferTx, failureReason: 'OTHER', failureDetail: detail }
  }
  log.info('distribute_submitted', { paymentId, tx: distributeTx, nonce: baseNonce + 1 })

  let distReceipt
  try {
    distReceipt = await publicClient.waitForTransactionReceipt({
      hash: distributeTx,
      timeout: 60_000,
      pollingInterval: 2000,
    })
  } catch (err) {
    return {
      success: false,
      transferTx,
      distributeTx,
      failureReason: 'OTHER',
      failureDetail: `distribute_receipt_timeout: ${(err as Error).message}`,
    }
  }

  if (distReceipt.status !== 'success') {
    return {
      success: false,
      transferTx,
      distributeTx,
      failureReason: 'TX_REVERTED',
      failureDetail: `distribute reverted at block ${distReceipt.blockNumber}`,
    }
  }

  // Fetch block timestamp. Fall back to `latest` if the specific block has
  // not yet propagated to all RPC nodes (viem throws "Block at number X could
  // not be found" in that race window).
  let blockTimestamp: bigint
  try {
    const block = await publicClient.getBlock({ blockNumber: transferReceipt.blockNumber })
    blockTimestamp = block.timestamp
  } catch {
    const latestBlock = await publicClient.getBlock({ blockTag: 'latest' })
    blockTimestamp = latestBlock.timestamp
    log.warn('block_fetch_fallback', { paymentId, block: String(transferReceipt.blockNumber), usingLatest: String(latestBlock.number) })
  }

  return {
    success: true,
    transferTx,
    distributeTx,
    blockNumber: transferReceipt.blockNumber,
    blockTimestamp,
    gasUsed: transferReceipt.gasUsed + distReceipt.gasUsed,
  }
}
