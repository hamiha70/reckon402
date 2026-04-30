import { describe, test, expect, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { setEnsRecords, canonicalRecordsString } from '../src/steps/set-ens-records.js'

describe('setEnsRecords', () => {
  test('POSTs signed payload to /admin/bootstrap with deterministic nonce + canonicalized records', async () => {
    const pk = generatePrivateKey()
    const acct = privateKeyToAccount(pk)

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      return new Response(JSON.stringify({
        updated: true, ensName: 'seller9.reckon402-test.eth', keys: ['x402.amount'], updatedAt: 1000,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const nonce = '0x' + '11'.repeat(32) as `0x${string}`
    const result = await setEnsRecords({
      gatewayBaseUrl: 'https://gateway.test',
      ensName: 'seller9.reckon402-test.eth',
      records: { 'x402.amount': '100000', 'x402.splitter': '0xABCD000000000000000000000000000000000001' },
      onboardingPk: pk,
    }, { fetch: fetchMock as any, nonce })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gateway.test/admin/bootstrap')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })

    // Body shape is fully asserted — NOT just "was called".
    const body = JSON.parse(init.body as string)
    expect(body.ensName).toBe('seller9.reckon402-test.eth')
    expect(body.nonce).toBe(nonce)
    expect(body.records).toEqual({
      'x402.amount': '100000',
      'x402.splitter': '0xABCD000000000000000000000000000000000001',
    })
    expect(body.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)

    // Signature verification: recover signer and assert it matches the key we signed with.
    // (Mock-passthrough guard: ensures the signed digest is over the canonicalized records,
    // not over some stale input.)
    const { recoverAddress, keccak256, encodeAbiParameters } = await import('viem')
    const canon = canonicalRecordsString(body.records)
    const digest = keccak256(encodeAbiParameters(
      [
        { name: 'chainId', type: 'uint256' },
        { name: 'ensName', type: 'string' },
        { name: 'key',     type: 'string' },
        { name: 'value',   type: 'string' },
        { name: 'nonce',   type: 'bytes32' },
      ],
      [11_155_111n, body.ensName, 'bootstrap', canon, body.nonce],
    ))
    const recovered = await recoverAddress({ hash: digest, signature: body.signature })
    expect(recovered.toLowerCase()).toBe(acct.address.toLowerCase())

    expect(result.gatewayResponse.updated).toBe(true)
    expect(result.bootstrapNonce).toBe(nonce)
  })

  test('non-OK gateway response → throws with status', async () => {
    const pk = generatePrivateKey()
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }))

    await expect(setEnsRecords({
      gatewayBaseUrl: 'https://gateway.test',
      ensName: 'seller9.reckon402-test.eth',
      records: { 'x402.amount': '1' },
      onboardingPk: pk,
    }, { fetch: fetchMock as any })).rejects.toThrow(/403/)
  })

  test('canonicalRecordsString sorts keys alphabetically', () => {
    const canon = canonicalRecordsString({ b: '2', a: '1', c: '3' })
    expect(canon).toBe('{"a":"1","b":"2","c":"3"}')
  })
})
