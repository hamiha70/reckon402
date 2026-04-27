import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import type { EIP3009Authorization } from '@reckon402/types'
import { USDC_ABI } from './abi/usdc.js'
import { SPLITTER_ABI } from './abi/splitter.js'
import { splitSignature } from './eip3009.js'

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
  const { publicClient, walletClient } = makeClients(env)

  // Deadline pre-check — cheap guard before spending gas.
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec >= Number(authorization.validBefore)) {
    return {
      success: false,
      failureReason: 'DEADLINE_EXCEEDED',
      failureDetail: `now=${nowSec} >= validBefore=${authorization.validBefore}`,
    }
  }

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
    })
  } catch (err) {
    return {
      success: false,
      failureReason: 'OTHER',
      failureDetail: `transferWithAuthorization_submit_failed: ${(err as Error).message}`,
    }
  }

  let transferReceipt
  try {
    transferReceipt = await publicClient.waitForTransactionReceipt({
      hash: transferTx,
      timeout: 60_000,
      pollingInterval: 2000,
    })
  } catch (err) {
    return {
      success: false,
      transferTx,
      failureReason: 'OTHER',
      failureDetail: `transfer_receipt_timeout: ${(err as Error).message}`,
    }
  }

  if (transferReceipt.status !== 'success') {
    return {
      success: false,
      transferTx,
      failureReason: 'TX_REVERTED',
      failureDetail: `transferWithAuthorization reverted at block ${transferReceipt.blockNumber}`,
    }
  }

  let distributeTx: Hex
  try {
    distributeTx = await walletClient.writeContract({
      address: env.SPLITTER_ADDRESS as Hex,
      abi: SPLITTER_ABI,
      functionName: 'distribute',
      args: [paymentId, BigInt(authorization.value)],
    })
  } catch (err) {
    return {
      success: false,
      transferTx,
      failureReason: 'OTHER',
      failureDetail: `distribute_submit_failed: ${(err as Error).message}`,
    }
  }

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

  const block = await publicClient.getBlock({ blockNumber: transferReceipt.blockNumber })

  return {
    success: true,
    transferTx,
    distributeTx,
    blockNumber: transferReceipt.blockNumber,
    blockTimestamp: block.timestamp,
    gasUsed: transferReceipt.gasUsed + distReceipt.gasUsed,
  }
}
