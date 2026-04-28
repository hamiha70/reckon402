#!/usr/bin/env node
/**
 * buyer-sign-l3.mjs — L3 buyer-signer using @reckon402/buyer-sdk.
 *
 * Differences from L2's buyer-sign.mjs:
 *   - auth.to = SPLITTER_ADDRESS (not seller EOA) — Q-04-α in spec 04 §5.1.
 *   - Reuses the exact same signPayment / computePaymentId from the SDK
 *     that the facilitator worker uses, so cross-impl divergence is
 *     impossible.
 *   - `REPLAY_NONCE` env var: if set to a 0x-prefixed 32-byte hex, uses
 *     that exact nonce (replay test reuses the previous run's nonce to
 *     get the same paymentId).
 *
 * Reads from env (Infisical-hydrated):
 *   BUYER_DEMO_1_PK             private key hex (0x-prefixed)
 *   BUYER_DEMO_1_ADDRESS        buyer EOA (optional; defaults to PK-derived)
 *   SPLITTER_ADDRESS            L3 Splitter contract address
 *   BASE_SEPOLIA_RPC_PRIMARY    present for informational logging only
 *   REPLAY_NONCE                optional override for the EIP-3009 nonce
 *
 * Emits base64-encoded PaymentPayload to stdout.
 * Logs paymentId + nonce to stderr for the replay script to capture.
 */

import { signPayment, encodeXPaymentHeader } from '@reckon402/buyer-sdk'

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const CHAIN_ID = 84532
const AMOUNT = '10000' // 0.01 USDC

const BUYER_PK = process.env.BUYER_DEMO_1_PK
const BUYER_ADDRESS = process.env.BUYER_DEMO_1_ADDRESS
const SPLITTER_ADDRESS = process.env.SPLITTER_ADDRESS
const REPLAY_NONCE = process.env.REPLAY_NONCE

if (!BUYER_PK) {
  console.error('ERROR: BUYER_DEMO_1_PK not set in environment')
  process.exit(1)
}
if (!SPLITTER_ADDRESS) {
  console.error('ERROR: SPLITTER_ADDRESS not set in environment')
  process.exit(1)
}

const signed = await signPayment({
  privateKey: BUYER_PK,
  buyerAddress: BUYER_ADDRESS,
  recipient: SPLITTER_ADDRESS,
  amount: AMOUNT,
  network: NETWORK,
  usdcAddress: USDC_BASE_SEPOLIA,
  chainId: CHAIN_ID,
  nonce: REPLAY_NONCE || undefined,
  resourceUrl: 'https://agent.reckon402.com/research',
})

console.error(`[buyer-sign-l3] buyer=${signed.authorization.from}`)
console.error(`[buyer-sign-l3] splitter=${signed.authorization.to}`)
console.error(`[buyer-sign-l3] amount=${AMOUNT} (0.01 USDC)`)
console.error(`[buyer-sign-l3] nonce=${signed.authorization.nonce}`)
console.error(`[buyer-sign-l3] validBefore=${signed.authorization.validBefore}`)
console.error(`[buyer-sign-l3] paymentId=${signed.paymentId}`)
console.error(`[buyer-sign-l3] replay=${REPLAY_NONCE ? 'YES (reused nonce)' : 'NO (fresh nonce)'}`)

// Emit the base64-encoded header value to stdout.
process.stdout.write(encodeXPaymentHeader(signed.payload))
