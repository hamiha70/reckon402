import { describe, it, expect } from 'vitest'
import type { WalletClient } from 'viem'
import { identity, reputation, validation, requireIdentityAddress, requireReputationAddress } from '../src/index.js'

type Call = { address: string; functionName: string; args: unknown[]; account: unknown }

function makeFakeWallet(txHash: `0x${string}` = '0xdeadbeef'): { client: WalletClient; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    account: { address: '0x0000000000000000000000000000000000000042', type: 'json-rpc' },
    writeContract: async (opts: any) => {
      calls.push({ address: opts.address, functionName: opts.functionName, args: opts.args, account: opts.account })
      return txHash
    },
  } as unknown as WalletClient
  return { client, calls }
}

describe('write APIs — mocked WalletClient (no live tx)', () => {
  it('identity.register(no args) dispatches to register() overload', async () => {
    const { client, calls } = makeFakeWallet()
    const tx = await identity.register({ chainId: 84532, walletClient: client })
    expect(tx).toBe('0xdeadbeef')
    expect(calls[0]?.address).toBe(requireIdentityAddress(84532))
    expect(calls[0]?.functionName).toBe('register')
    expect(calls[0]?.args).toEqual([])
  })

  it('identity.register(uri) dispatches to register(string) overload', async () => {
    const { client, calls } = makeFakeWallet()
    await identity.register({ chainId: 84532, walletClient: client, agentURI: 'ipfs://hello' })
    expect(calls[0]?.args).toEqual(['ipfs://hello'])
  })

  it('identity.register(uri, metadata) dispatches to 2-arg overload', async () => {
    const { client, calls } = makeFakeWallet()
    await identity.register({
      chainId: 84532,
      walletClient: client,
      agentURI: 'ipfs://hello',
      metadata: [{ metadataKey: 'x402.facilitator', metadataValue: '0x' as `0x${string}` }],
    })
    expect(calls[0]?.args).toEqual([
      'ipfs://hello',
      [{ metadataKey: 'x402.facilitator', metadataValue: '0x' }],
    ])
  })

  it('identity.setAgentWallet forwards the 4-arg (agentId, newWallet, deadline, sig)', async () => {
    const { client, calls } = makeFakeWallet()
    const sig = ('0x' + 'ab'.repeat(65)) as `0x${string}`
    await identity.setAgentWallet({
      chainId: 84532,
      walletClient: client,
      agentId: 1n,
      newWallet: '0x0000000000000000000000000000000000000001',
      deadline: 999_999n,
      signature: sig,
    })
    expect(calls[0]?.functionName).toBe('setAgentWallet')
    expect(calls[0]?.args).toEqual([1n, '0x0000000000000000000000000000000000000001', 999_999n, sig])
  })

  it('reputation.giveFeedback forwards the 8-arg upstream signature', async () => {
    const { client, calls } = makeFakeWallet()
    await reputation.giveFeedback({
      chainId: 84532,
      walletClient: client,
      agentId: 1n,
      value: 100n,
      valueDecimals: 2,
      tag1: 'payment',
      tag2: 'x402-settlement',
      endpoint: 'https://agent.reckon402.com/research',
      feedbackURI: '',
      feedbackHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
    })
    expect(calls[0]?.address).toBe(requireReputationAddress(84532))
    expect(calls[0]?.functionName).toBe('giveFeedback')
    expect(calls[0]?.args).toEqual([
      1n, 100n, 2, 'payment', 'x402-settlement',
      'https://agent.reckon402.com/research', '',
      '0x' + '00'.repeat(32),
    ])
  })

  it('reputation.revokeFeedback + appendResponse forward args', async () => {
    const { client, calls } = makeFakeWallet()
    await reputation.revokeFeedback({ chainId: 84532, walletClient: client, agentId: 1n, feedbackIndex: 3n })
    await reputation.appendResponse({
      chainId: 84532,
      walletClient: client,
      agentId: 1n,
      clientAddress: '0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1',
      feedbackIndex: 3n,
      responseURI: 'ipfs://response',
      responseHash: ('0x' + '11'.repeat(32)) as `0x${string}`,
    })
    expect(calls.map((c) => c.functionName)).toEqual(['revokeFeedback', 'appendResponse'])
    expect(calls[0]?.args).toEqual([1n, 3n])
    expect(calls[1]?.args).toEqual([
      1n,
      '0xE7251742c6f4F8849600d44c6aed62e07DaA7Ea1',
      3n,
      'ipfs://response',
      '0x' + '11'.repeat(32),
    ])
  })

  it('validation.validationRequest throws VALIDATION_NOT_DEPLOYED (no write attempted)', async () => {
    const { client, calls } = makeFakeWallet()
    await expect(
      validation.validationRequest({
        chainId: 84532,
        walletClient: client,
        validatorAddress: '0x0000000000000000000000000000000000000000',
        agentId: 1n,
        requestURI: '',
        requestHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
      }),
    ).rejects.toThrow(/VALIDATION_NOT_DEPLOYED/)
    expect(calls).toHaveLength(0)
  })

  it('writes throw WALLET_CLIENT_ACCOUNT_MISSING when .account is absent', async () => {
    const client = { account: undefined, writeContract: async () => '0x' } as unknown as WalletClient
    await expect(identity.register({ chainId: 84532, walletClient: client })).rejects.toThrow(
      /WALLET_CLIENT_ACCOUNT_MISSING/,
    )
  })
})
