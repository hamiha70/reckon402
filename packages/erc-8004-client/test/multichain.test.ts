import { describe, it, expect } from 'vitest'
import {
  CHAIN_CONFIGS,
  UPSTREAM_ABI_COMMIT,
  getChainConfig,
  listSupportedChains,
  requireIdentityAddress,
  requireReputationAddress,
  requireValidationAddress,
} from '../src/index.js'

describe('multichain', () => {
  it('pins the upstream commit SHA as a constant', () => {
    expect(UPSTREAM_ABI_COMMIT).toBe('0463311492b3a7fc5fdb6990231cce721ff6cf97')
    // Full 40-hex SHA so drift audits can pin it
    expect(UPSTREAM_ABI_COMMIT).toMatch(/^[0-9a-f]{40}$/)
  })

  it('supports exactly the four pinned chains', () => {
    const chains = listSupportedChains().map((c) => c.chainId).sort((a, b) => a - b)
    expect(chains).toEqual([1, 8453, 84532, 11155111])
  })

  it('Base Sepolia (84532) has Identity + Reputation, no Validation', () => {
    const cfg = getChainConfig(84532)
    expect(cfg.name).toBe('base-sepolia')
    expect(cfg.identityRegistry).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e')
    expect(cfg.reputationRegistry).toBe('0x8004B663056A597Dffe9eCcC1965A193B7388713')
    expect(cfg.validationRegistry).toBeNull()
  })

  it('Base Mainnet (8453) has Identity + Reputation, no Validation', () => {
    const cfg = getChainConfig(8453)
    expect(cfg.identityRegistry).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
    expect(cfg.reputationRegistry).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63')
    expect(cfg.validationRegistry).toBeNull()
  })

  it('Base Sepolia + ETH Sepolia share Identity/Reputation addresses', () => {
    const baseSep = getChainConfig(84532)
    const ethSep = getChainConfig(11155111)
    expect(ethSep.identityRegistry).toBe(baseSep.identityRegistry)
    expect(ethSep.reputationRegistry).toBe(baseSep.reputationRegistry)
  })

  it('Base Mainnet + ETH Mainnet share Identity/Reputation addresses', () => {
    const baseMain = getChainConfig(8453)
    const ethMain = getChainConfig(1)
    expect(ethMain.identityRegistry).toBe(baseMain.identityRegistry)
    expect(ethMain.reputationRegistry).toBe(baseMain.reputationRegistry)
  })

  it('Base Mainnet addresses DIFFER from Base Sepolia (not the same CREATE2 salt)', () => {
    const baseSep = getChainConfig(84532)
    const baseMain = getChainConfig(8453)
    expect(baseMain.identityRegistry).not.toBe(baseSep.identityRegistry)
    expect(baseMain.reputationRegistry).not.toBe(baseSep.reputationRegistry)
  })

  it('getChainConfig throws on unknown chainId', () => {
    expect(() => getChainConfig(999_999)).toThrow(/UNSUPPORTED_CHAIN/)
  })

  it('requireValidationAddress throws VALIDATION_NOT_DEPLOYED on every pinned chain', () => {
    for (const chainId of Object.keys(CHAIN_CONFIGS).map(Number)) {
      expect(() => requireValidationAddress(chainId)).toThrow(/VALIDATION_NOT_DEPLOYED/)
    }
  })

  it('requireIdentityAddress / requireReputationAddress succeed on every pinned chain', () => {
    for (const chainId of Object.keys(CHAIN_CONFIGS).map(Number)) {
      expect(requireIdentityAddress(chainId)).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(requireReputationAddress(chainId)).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })
})
