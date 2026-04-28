import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeEnv, makeApp, makeFakeDb } from './helpers.js'
import type { Env } from '../../src/env.js'

// Mock viem's createPublicClient so we don't need a real RPC
vi.mock('viem', async (importOriginal) => {
  const original = await importOriginal<typeof import('viem')>()
  return {
    ...original,
    createPublicClient: vi.fn(() => ({
      getBlockNumber: vi.fn(async () => 12345n),
    })),
  }
})

describe('GET /healthz', () => {
  test('returns 200 with status=ok when core deps pass', async () => {
    const env = makeEnv()
    const app = makeApp(env)

    const res = await app.request('GET', '/healthz')
    expect(res.status).toBe(200)

    const body = await res.json() as {
      status: string
      checks: Record<string, { ok: boolean }>
      env_flags: Record<string, string>
    }
    expect(body.checks['d1_records'].ok).toBe(true)
    expect(body.checks['signing_key_loaded'].ok).toBe(true)
  })

  test('returns 200 with status=degraded when RPC fails', async () => {
    const { createPublicClient } = await import('viem')
    vi.mocked(createPublicClient).mockReturnValueOnce({
      getBlockNumber: async () => { throw new Error('RPC unreachable') },
    } as ReturnType<typeof createPublicClient>)

    const env = makeEnv()
    const app = makeApp(env)

    const res = await app.request('GET', '/healthz')
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('degraded')
  })

  test('returns 503 with status=down when signing key missing', async () => {
    const env = makeEnv([], { RECKON402_RESOLVER_SIGNER_PK: '' as `0x${string}` })
    const app = makeApp(env)

    const res = await app.request('GET', '/healthz')
    expect(res.status).toBe(503)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('down')
  })

  test('response includes env_flags with correct defaults', async () => {
    const env = makeEnv()
    const app = makeApp(env)

    const res = await app.request('GET', '/healthz')
    const body = await res.json() as { env_flags: Record<string, string> }
    expect(body.env_flags['ENABLE_ERC8004_READS']).toBe('false')
    expect(body.env_flags['STEALTH_ENABLED']).toBe('false')
  })
})
