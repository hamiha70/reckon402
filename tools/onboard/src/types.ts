import type { Hex } from 'viem'

export type StepId = 1 | 2 | 3 | 4 | 5

export interface OnboardStep {
  id:            StepId
  label:         string
  txHash?:       Hex
  externalLink?: string
  /**
   * Free-form one-line annotation surfaced inline in the progress UI. Used for
   * salient post-result values that aren't a tx hash (e.g. step 3 sets this to
   * `agentId=<n>` so the user sees the minted ERC-8004 id in the form before
   * being redirected to the dashboard).
   */
  note?:         string
  startedAt:     number
  completedAt?:  number
  error?:        string
}

export interface OnboardArgs {
  name:          string            // full ENS name, e.g. "seller9.reckon402-test.eth"
  parentName:    string            // e.g. "reckon402-test.eth"
  label:         string            // e.g. "seller9"
  sellerEoa:     `0x${string}`     // subname owner + recipients[0]
  endpoint:      string            // HTTPS URL where SellingAgent serves paid requests
  amount:        string            // atomic USDC base units, e.g. "100000" = 0.10 USDC
  recipients?:   `0x${string}`[]   // optional splitter recipients; default [sellerEoa]
  bps?:          number[]          // optional BPS; default [10_000]
  progressSink?: (step: OnboardStep) => void | Promise<void>
}

export interface OnboardResult {
  ensName:              string
  sellerEoa:            `0x${string}`
  agentId:              bigint
  splitter:             `0x${string}`
  splitterDeployTx:     Hex | null   // null if already deployed (idempotent)
  subnameRegisterTx:    Hex
  subnameOwnerTransferTx: Hex | null  // null if seller never became final owner
  agentRegisterTx:      Hex
  agentTransferTx:      Hex | null   // null if registered directly as seller
  steps:                OnboardStep[]
}

export interface OnboardEnv {
  // RPCs
  ETH_SEPOLIA_RPC_PRIMARY:   string
  BASE_SEPOLIA_RPC_PRIMARY:  string

  // Signing keys (Infisical-injected)
  ENS_FUNDER_PK:             `0x${string}`  // signs setSubnodeOwner / setResolver / setAddr on Sepolia
  RECKON402_DEPLOYER_PK:     `0x${string}`  // signs createSplitter / registerAgent on Base Sepolia
  RECKON402_ONBOARDING_PK:   `0x${string}`  // signs admin/bootstrap payloads

  // Contract addresses
  SPLITTER_FACTORY_ADDRESS:  `0x${string}`  // Base Sepolia
  RECKON402_RESOLVER_SEPOLIA: `0x${string}` // 0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a
  IDENTITY_REGISTRY_BASE_SEPOLIA: `0x${string}` // 0x8004A818BFB912233c491871b3d84c89A494BD9e

  // Reckon402 infra URLs
  GATEWAY_BASE_URL:          string         // https://gateway.reckon402.com
  FACILITATOR_BASE_URL:      string         // https://facilitator.reckon402.com

  // Logical values
  CHAIN_ID_BASE_SEPOLIA:     84532
}

export const PARENT_RESOLVER_ENS_SEPOLIA = '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a' as const
export const IDENTITY_REGISTRY_BASE_SEPOLIA = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
export const ENS_REGISTRY_SEPOLIA = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
export const PUBLIC_RESOLVER_SEPOLIA = '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD' as const
