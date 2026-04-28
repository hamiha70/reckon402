import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import type {
  EIP3009Authorization,
  PaymentPayload,
  PaymentRequirements,
} from '@reckon402/types'
import { computePaymentId } from './payment-id.js'

export interface SignPaymentInput {
  /** 0x-prefixed 32-byte private key. */
  privateKey: Hex
  /** Recipient of the USDC transfer — at L3 this is the Splitter address. */
  recipient: `0x${string}`
  /** Atomic-units amount as a string (e.g. "10000" = 0.01 USDC). */
  amount: string
  /** CAIP-2, e.g. "eip155:84532". */
  network: string
  /** USDC contract address on the target chain. */
  usdcAddress: `0x${string}`
  /** Numeric chainId, matching `network`. */
  chainId: number
  /** Seconds in the future for validBefore (default 600). */
  validSeconds?: number
  /** Override buyer address (default: derive from privateKey). */
  buyerAddress?: `0x${string}`
  /** Optional nonce override (default: random 32 bytes). */
  nonce?: `0x${string}`
  /** Optional validBefore override as unix seconds (default: now + validSeconds). */
  validBeforeOverride?: bigint
  /** Optional resource URL to embed in the payload. */
  resourceUrl?: string
}

export interface SignedPayment {
  payload: PaymentPayload
  paymentId: Hex
  /** Convenience copy of the chosen PaymentRequirements. */
  requirements: PaymentRequirements
  /** Convenience copy of the authorization struct. */
  authorization: EIP3009Authorization
}

/**
 * Sign an EIP-3009 TransferWithAuthorization for the Reckon402 x402 flow.
 * Returns a complete PaymentPayload ready to be base64-encoded into the
 * PAYMENT-SIGNATURE header via encodeXPaymentHeader().
 */
export async function signPayment(input: SignPaymentInput): Promise<SignedPayment> {
  const {
    privateKey,
    recipient,
    amount,
    network,
    usdcAddress,
    chainId,
    validSeconds = 600,
    resourceUrl,
  } = input

  const account = privateKeyToAccount(privateKey)
  const buyerAddress = input.buyerAddress ?? account.address

  const nonce =
    input.nonce ??
    (() => {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
    })()

  const validAfter = 0n
  const validBefore = input.validBeforeOverride ?? BigInt(Math.floor(Date.now() / 1000) + validSeconds)

  const signature = (await account.signTypedData({
    domain: {
      name: 'USDC',
      version: '2',
      chainId,
      verifyingContract: usdcAddress,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: buyerAddress,
      to: recipient,
      value: BigInt(amount),
      validAfter,
      validBefore,
      nonce,
    },
  })) as Hex

  const authorization: EIP3009Authorization = {
    from: buyerAddress,
    to: recipient,
    value: amount,
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  }

  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network,
    amount,
    asset: usdcAddress,
    payTo: recipient,
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  }

  const payload: PaymentPayload = {
    x402Version: 2,
    resource: resourceUrl ? { url: resourceUrl } : undefined,
    accepted: requirements,
    payload: { signature, authorization },
  }

  return {
    payload,
    paymentId: computePaymentId(authorization),
    requirements,
    authorization,
  }
}
