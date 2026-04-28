import type { ChainConfig } from './types.js'

/**
 * Upstream repo: https://github.com/erc-8004/erc-8004-contracts
 * Pinned master commit (audit drift against this SHA):
 */
export const UPSTREAM_ABI_COMMIT = '0463311492b3a7fc5fdb6990231cce721ff6cf97' as const

/**
 * Canonical ChainConfigs. Addresses are hardcoded constants, not env-
 * configurable. Changing them means bumping UPSTREAM_ABI_COMMIT and
 * rebuilding the library.
 *
 * Notes:
 * - Base Sepolia + ETH Sepolia share the same Identity / Reputation
 *   addresses (same CREATE2 salt across testnets).
 * - Base Mainnet + ETH Mainnet share a different pair.
 * - ValidationRegistry is NULL across all chains at the pinned commit
 *   (upstream marks it "under active TEE-community discussion"). The
 *   Validation API surfaces throw VALIDATION_NOT_DEPLOYED on any
 *   chain where the address is null.
 */
export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  84532: {
    chainId: 84532,
    name: 'base-sepolia',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    validationRegistry: null,
  },
  8453: {
    chainId: 8453,
    name: 'base-mainnet',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    validationRegistry: null,
  },
  11155111: {
    chainId: 11155111,
    name: 'ethereum-sepolia',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    validationRegistry: null,
  },
  1: {
    chainId: 1,
    name: 'ethereum-mainnet',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    validationRegistry: null,
  },
}

export function getChainConfig(chainId: number): ChainConfig {
  const cfg = CHAIN_CONFIGS[chainId]
  if (!cfg) {
    throw new Error(
      `UNSUPPORTED_CHAIN: chainId=${chainId} not pinned in @reckon402/erc-8004-client`,
    )
  }
  return cfg
}

export function listSupportedChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS)
}

export function requireIdentityAddress(chainId: number): `0x${string}` {
  const addr = getChainConfig(chainId).identityRegistry
  if (!addr) throw new Error(`IDENTITY_NOT_DEPLOYED: chainId=${chainId}`)
  return addr
}

export function requireReputationAddress(chainId: number): `0x${string}` {
  const addr = getChainConfig(chainId).reputationRegistry
  if (!addr) throw new Error(`REPUTATION_NOT_DEPLOYED: chainId=${chainId}`)
  return addr
}

export function requireValidationAddress(chainId: number): `0x${string}` {
  const addr = getChainConfig(chainId).validationRegistry
  if (!addr) throw new Error(`VALIDATION_NOT_DEPLOYED: chainId=${chainId}`)
  return addr
}
