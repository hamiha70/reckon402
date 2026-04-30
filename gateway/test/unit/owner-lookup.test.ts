import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoisted mock for viem. Captured so tests can assert exact args passed to
// readContract — the mock-passthrough blindspot feedback: if we only check
// the return value, we never catch "owner-lookup called the wrong contract".
const readContractMock = vi.fn()
const createPublicClientMock = vi.fn(() => ({ readContract: readContractMock }))
const httpMock = vi.fn((url: string, opts: unknown) => ({ __transport: true, url, opts }))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    http: httpMock,
  }
})

type D1RunResult = { success: boolean }

function makeFakeDb(cache: Map<string, { owner_addr: string; cached_at: number }>) {
  const runCalls: Array<{ sql: string; args: unknown[] }> = []
  const firstCalls: Array<{ sql: string; args: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              firstCalls.push({ sql, args })
              if (!sql.includes('SELECT')) return null
              const name = args[0] as string
              const row = cache.get(name)
              return (row ?? null) as T | null
            },
            async run(): Promise<D1RunResult> {
              runCalls.push({ sql, args })
              // Emulate ON CONFLICT upsert behavior.
              const [name, owner, cachedAt] = args as [string, string, number]
              cache.set(name, { owner_addr: owner, cached_at: cachedAt })
              return { success: true }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as import('@cloudflare/workers-types').D1Database, runCalls, firstCalls }
}

function makeEnv(db: import('@cloudflare/workers-types').D1Database) {
  return { DB: db, ETH_SEPOLIA_RPC_PRIMARY: 'https://eth-sepolia.example.com' }
}

// Lowercased input — lookup module checksum-normalizes before returning.
const SELLER_EOA_LOWER = '0xd53f000000000000000000000000000000000001'
// Computed via viem.getAddress at test-run time — do not hand-edit.
let SELLER_EOA_CHECKSUM: `0x${string}`
let NEW_OWNER_LOWER: string
let NEW_OWNER_CHECKSUM: `0x${string}`

describe('getEnsOwner', () => {
  beforeEach(async () => {
    readContractMock.mockReset()
    createPublicClientMock.mockClear()
    httpMock.mockClear()
    const { getAddress } = await import('viem')
    SELLER_EOA_CHECKSUM = getAddress(SELLER_EOA_LOWER) as `0x${string}`
    NEW_OWNER_LOWER = '0xabcd000000000000000000000000000000000002'
    NEW_OWNER_CHECKSUM = getAddress(NEW_OWNER_LOWER) as `0x${string}`
  })

  afterEach(() => vi.useRealTimers())

  test('cache miss → RPC call → cache write → normalized checksum returned', async () => {
    const { getEnsOwner, ENS_REGISTRY_ADDRESS } = await import('../../src/ens/owner-lookup.js')
    const { namehash } = await import('viem')

    const cache = new Map()
    const { db, runCalls, firstCalls } = makeFakeDb(cache)
    readContractMock.mockResolvedValue(SELLER_EOA_LOWER)

    const result = await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', { now: 1_000_000 })

    // RPC called with exactly these args (no placeholders allowed)
    expect(readContractMock).toHaveBeenCalledTimes(1)
    expect(readContractMock).toHaveBeenCalledWith({
      address: ENS_REGISTRY_ADDRESS,
      abi: expect.any(Array),
      functionName: 'owner',
      args: [namehash('seller9.reckon402-test.eth')],
    })

    // Transport built against the primary RPC
    expect(httpMock).toHaveBeenCalledWith('https://eth-sepolia.example.com', { timeout: 10_000 })

    // Cache read was attempted first (before RPC)
    expect(firstCalls[0]).toMatchObject({
      sql: expect.stringContaining('SELECT'),
      args: ['seller9.reckon402-test.eth'],
    })

    // Cache upsert happened with exact args
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.args).toEqual([
      'seller9.reckon402-test.eth',
      expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
      1_000_000,
    ])

    // Return value is checksum-normalized
    expect(result).toBe(SELLER_EOA_CHECKSUM)
  })

  test('cache hit within TTL short-circuits — no RPC call', async () => {
    const { getEnsOwner, OWNER_CACHE_TTL_MS } = await import('../../src/ens/owner-lookup.js')

    const cache = new Map([
      ['seller9.reckon402-test.eth', { owner_addr: SELLER_EOA_LOWER, cached_at: 999_000 }],
    ])
    const { db, runCalls } = makeFakeDb(cache)

    const result = await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', {
      now: 999_000 + OWNER_CACHE_TTL_MS - 1,
    })

    expect(result).toBe(SELLER_EOA_CHECKSUM)
    expect(readContractMock).not.toHaveBeenCalled()
    expect(runCalls).toHaveLength(0) // no re-cache
  })

  test('cache expired → RPC re-fetch; cache overwritten', async () => {
    const { getEnsOwner, OWNER_CACHE_TTL_MS } = await import('../../src/ens/owner-lookup.js')

    const cache = new Map([
      ['seller9.reckon402-test.eth', { owner_addr: SELLER_EOA_LOWER, cached_at: 1_000_000 }],
    ])
    const { db, runCalls } = makeFakeDb(cache)
    readContractMock.mockResolvedValue(NEW_OWNER_LOWER)

    const now = 1_000_000 + OWNER_CACHE_TTL_MS + 1
    const result = await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', { now })

    expect(readContractMock).toHaveBeenCalledTimes(1)
    expect(result).toBe(NEW_OWNER_CHECKSUM)
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.args).toEqual([
      'seller9.reckon402-test.eth',
      NEW_OWNER_CHECKSUM,
      now,
    ])
  })

  test('bypassCache=true skips cache read; still writes cache', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')

    const cache = new Map([
      ['seller9.reckon402-test.eth', { owner_addr: SELLER_EOA_LOWER, cached_at: 1_000_000 }],
    ])
    const { db, firstCalls, runCalls } = makeFakeDb(cache)
    readContractMock.mockResolvedValue(SELLER_EOA_LOWER)

    await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', {
      bypassCache: true,
      now: 1_000_100,
    })

    // No SELECT from cache
    expect(firstCalls.filter(c => c.sql.includes('SELECT'))).toHaveLength(0)
    expect(readContractMock).toHaveBeenCalledTimes(1)
    expect(runCalls).toHaveLength(1)
  })

  test('RPC throws → returns null; no cache write', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')

    const cache = new Map()
    const { db, runCalls } = makeFakeDb(cache)
    readContractMock.mockRejectedValue(new Error('RPC down'))

    const result = await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', { now: 1_000_000 })

    expect(result).toBeNull()
    expect(runCalls).toHaveLength(0)
  })

  test('owner() returns zero address → null (unowned name)', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')

    const cache = new Map()
    const { db, runCalls } = makeFakeDb(cache)
    readContractMock.mockResolvedValue('0x0000000000000000000000000000000000000000')

    const result = await getEnsOwner(makeEnv(db), 'seller9.reckon402-test.eth', { now: 1_000_000 })

    expect(result).toBeNull()
    expect(runCalls).toHaveLength(0)
  })

  test('empty ENS name → null; no RPC attempt', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')

    const { db } = makeFakeDb(new Map())
    const result = await getEnsOwner(makeEnv(db), '', { now: 1_000_000 })

    expect(result).toBeNull()
    expect(readContractMock).not.toHaveBeenCalled()
  })

  test('name with whitespace → null; no RPC attempt', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')
    const { db } = makeFakeDb(new Map())
    const result = await getEnsOwner(makeEnv(db), 'sel ler9.reckon402-test.eth', { now: 1_000_000 })
    expect(result).toBeNull()
    expect(readContractMock).not.toHaveBeenCalled()
  })

  test('cache read throws → falls through to RPC; still returns owner', async () => {
    const { getEnsOwner } = await import('../../src/ens/owner-lookup.js')

    const brokenDb = {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return {
              async first() {
                if (sql.includes('SELECT')) throw new Error('D1 transient')
                return null
              },
              async run() {
                return { success: true }
              },
            }
          },
        }
      },
    } as unknown as import('@cloudflare/workers-types').D1Database

    readContractMock.mockResolvedValue(SELLER_EOA_LOWER)
    const result = await getEnsOwner(
      { DB: brokenDb, ETH_SEPOLIA_RPC_PRIMARY: 'https://eth-sepolia.example.com' },
      'seller9.reckon402-test.eth',
      { now: 1_000_000 },
    )

    expect(result).toBe(SELLER_EOA_CHECKSUM)
    expect(readContractMock).toHaveBeenCalledTimes(1)
  })
})
