import { describe, test, expect, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { seedGateway } from '../src/steps/seed-gateway.js'
import { canonicalRecordsString } from '../src/steps/set-ens-records.js'

describe('seedGateway', () => {
  test('POSTs signed payload to /admin/bootstrap/gateway-seed with exact fields', async () => {
    const pk = generatePrivateKey()
    const acct = privateKeyToAccount(pk)

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ seeded: true, ensName: 'seller9.reckon402-test.eth', chainId: 84532, agentId: '3', updatedAt: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const nonce = '0x' + '22'.repeat(32) as `0x${string}`
    const records = { 'x402.amount': '100000', 'x402.facilitator': 'https://f.example.com' }
    const result = await seedGateway({
      gatewayBaseUrl: 'https://gateway.test',
      ensName: 'seller9.reckon402-test.eth',
      chainId: 84532,
      agentId: 3n,
      records,
      onboardingPk: pk,
    }, { fetch: fetchMock as any, nonce })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gateway.test/admin/bootstrap/gateway-seed')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      ensName: 'seller9.reckon402-test.eth',
      chainId: 84532,
      agentId: '3',        // stringified bigint for JSON safety
      records,
      nonce,
    })

    // Verify signature recovers to the onboarding key over the chainId:agentId:canon digest
    const { recoverAddress, keccak256, encodeAbiParameters } = await import('viem')
    const canon = canonicalRecordsString(records)
    const digestValue = `84532:3:${canon}`
    const digest = keccak256(encodeAbiParameters(
      [
        { name: 'chainId', type: 'uint256' },
        { name: 'ensName', type: 'string' },
        { name: 'key',     type: 'string' },
        { name: 'value',   type: 'string' },
        { name: 'nonce',   type: 'bytes32' },
      ],
      [11_155_111n, body.ensName, 'gateway-seed', digestValue, body.nonce],
    ))
    const recovered = await recoverAddress({ hash: digest, signature: body.signature })
    expect(recovered.toLowerCase()).toBe(acct.address.toLowerCase())

    expect(result.gatewayResponse.seeded).toBe(true)
  })

  test('non-OK gateway response → throws', async () => {
    const pk = generatePrivateKey()
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(seedGateway({
      gatewayBaseUrl: 'https://gateway.test',
      ensName: 'seller9.reckon402-test.eth',
      chainId: 84532,
      agentId: 1n,
      records: { 'x402.amount': '1' },
      onboardingPk: pk,
    }, { fetch: fetchMock as any })).rejects.toThrow(/500/)
  })
})
