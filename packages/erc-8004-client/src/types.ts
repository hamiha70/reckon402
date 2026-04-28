import type { Address, Hex } from 'viem'

export interface ChainConfig {
  chainId: number
  name: string
  identityRegistry: Address | null
  reputationRegistry: Address | null
  validationRegistry: Address | null
}

export interface Agent {
  agentId: bigint
  owner: Address
  wallet: Address
  tokenURI: string
}

export interface ReputationSummary {
  count: bigint
  summaryValue: bigint
  decimals: number
}

export interface FeedbackEntry {
  client: Address
  feedbackIndex: bigint
  value: bigint
  decimals: number
  tag1: string
  tag2: string
  isRevoked: boolean
}

export interface ValidationStatus {
  validator: Address
  agentId: bigint
  response: number
  responseHash: Hex
  tag: string
  lastUpdate: bigint
}

export interface KVCache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}
