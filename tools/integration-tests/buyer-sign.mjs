#!/usr/bin/env node
/**
 * buyer-sign.mjs — one-shot EIP-3009 authorization signer for L2 integration test.
 *
 * Reads from env (hydrated by Infisical):
 *   BUYER_DEMO_1_PK         private key hex (0x-prefixed)
 *   BUYER_DEMO_1_ADDRESS    buyer EOA address
 *   SELLER_ADDRESS          seller EOA address (or hardcoded fallback)
 *   BASE_SEPOLIA_RPC_PRIMARY RPC URL (not used for signing, present for verification)
 *
 * Emits the base64-encoded PAYMENT-SIGNATURE header value to stdout.
 * No HTTP. No side effects.
 *
 * Per AGENTS.md "tools/" exception: .mjs allowed for one-shot CLI scripts.
 * Will graduate to packages/buyer-sdk/src/sign.ts in L3.
 */

import { createWalletClient, http, encodePacked, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const BUYER_PK = process.env.BUYER_DEMO_1_PK
const BUYER_ADDRESS = process.env.BUYER_DEMO_1_ADDRESS
const SELLER_ADDRESS = process.env.SELLER_ADDRESS ?? '0xD53ffac42496d73B3Faf946786688a8454F57b1f'

if (!BUYER_PK) {
  console.error('ERROR: BUYER_DEMO_1_PK not set in environment')
  process.exit(1)
}

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const NETWORK = 'eip155:84532'
const AMOUNT = '10000'  // 0.01 USDC

const account = privateKeyToAccount(BUYER_PK)
const effectiveBuyerAddress = BUYER_ADDRESS ?? account.address

const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
})

// EIP-712 domain for USDC on Base Sepolia
const domain = {
  name: 'USDC',
  version: '2',
  chainId: 84532,
  verifyingContract: USDC_BASE_SEPOLIA,
}

const types = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
}

const validAfter = BigInt(0)
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600)  // now + 10 min

// Random nonce: 32 bytes
const nonceBytes = new Uint8Array(32)
crypto.getRandomValues(nonceBytes)
const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

const message = {
  from: effectiveBuyerAddress,
  to: SELLER_ADDRESS,
  value: BigInt(AMOUNT),
  validAfter,
  validBefore,
  nonce,
}

const signature = await client.signTypedData({
  domain,
  types,
  primaryType: 'TransferWithAuthorization',
  message,
})

const authorization = {
  from: effectiveBuyerAddress,
  to: SELLER_ADDRESS,
  value: AMOUNT,
  validAfter: validAfter.toString(),
  validBefore: validBefore.toString(),
  nonce,
}

const paymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: 'exact',
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC_BASE_SEPOLIA,
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  },
  payload: {
    signature,
    authorization,
  },
}

// Compute paymentId locally for logging
const packed = encodePacked(
  ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
  [authorization.from, authorization.to, BigInt(AMOUNT), validAfter, validBefore, nonce]
)
const paymentId = keccak256(packed)

console.error(`[buyer-sign] buyer=${effectiveBuyerAddress}`)
console.error(`[buyer-sign] seller=${SELLER_ADDRESS}`)
console.error(`[buyer-sign] amount=${AMOUNT} (0.01 USDC)`)
console.error(`[buyer-sign] network=${NETWORK}`)
console.error(`[buyer-sign] validBefore=${validBefore} (${new Date(Number(validBefore) * 1000).toISOString()})`)
console.error(`[buyer-sign] nonce=${nonce}`)
console.error(`[buyer-sign] paymentId=${paymentId}`)
console.error(`[buyer-sign] signature=${signature}`)

// Emit encoded header value to stdout (for curl -H "PAYMENT-SIGNATURE: $(node buyer-sign.mjs)")
process.stdout.write(btoa(JSON.stringify(paymentPayload)))
