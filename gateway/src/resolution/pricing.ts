import type { ReputationSummary } from '@reckon402/erc-8004-client'

/**
 * Step-function pricing tier per design doc §6.2.
 * Hot-swappable — callers depend only on the numeric return (bps).
 */
export function tierBpsFromCount(count: bigint): number {
  if (count === 0n) return 0
  if (count <= 2n) return 500
  if (count <= 9n) return 1000
  return 1500
}

type PricingKey = 'x402.amount' | 'x402.pricing'

export interface PricingApplyArgs {
  key: PricingKey
  baseValue: string
  summary: ReputationSummary
}

/**
 * Apply a reputation-derived discount to the base record value.
 * - `x402.amount`: integer base-units (USDC micro-units). Apply bps
 *   off. Returns the adjusted integer as a decimal string.
 * - `x402.pricing`: JSON object; attach `discount_bps` field.
 */
export function applyPricingTier(args: PricingApplyArgs): string {
  const bps = tierBpsFromCount(args.summary.count)
  if (args.key === 'x402.amount') {
    if (!args.baseValue) return args.baseValue
    let amount: bigint
    try {
      amount = BigInt(args.baseValue)
    } catch {
      return args.baseValue
    }
    const discounted = (amount * BigInt(10_000 - bps)) / 10_000n
    return discounted.toString()
  }
  const parsed = args.baseValue ? safeJsonParseObject(args.baseValue) : {}
  return JSON.stringify({ ...parsed, discount_bps: bps })
}

function safeJsonParseObject(input: string): Record<string, unknown> {
  try {
    const v = JSON.parse(input)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // fall-through
  }
  return {}
}

export function isPricingKey(key: string): key is PricingKey {
  return key === 'x402.amount' || key === 'x402.pricing'
}
