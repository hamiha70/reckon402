import { describe, it, expect } from 'vitest'
import { NoopCache, LruCache, cacheKey, argDigest } from '../src/index.js'

describe('NoopCache', () => {
  it('get always returns null; set/delete are side-effect-free', async () => {
    const c = new NoopCache()
    await c.set('k', 'v', 60)
    expect(await c.get('k')).toBeNull()
    await c.delete('k')
    expect(await c.get('k')).toBeNull()
  })
})

describe('LruCache', () => {
  it('returns set values within TTL', async () => {
    let now = 1_000_000
    const c = new LruCache({ now: () => now })
    await c.set('k', 'v', 60)
    expect(await c.get('k')).toBe('v')
    now += 30_000 // 30s later, still within TTL
    expect(await c.get('k')).toBe('v')
  })

  it('returns null once TTL expires', async () => {
    let now = 0
    const c = new LruCache({ now: () => now })
    await c.set('k', 'v', 60)
    now = 60_001 // past 60s
    expect(await c.get('k')).toBeNull()
  })

  it('evicts least-recently-used when max capacity exceeded', async () => {
    const c = new LruCache({ max: 2 })
    await c.set('a', '1', 60)
    await c.set('b', '2', 60)
    // access a to bump it to MRU
    await c.get('a')
    await c.set('c', '3', 60)
    // b was LRU → evicted; a + c remain
    expect(await c.get('b')).toBeNull()
    expect(await c.get('a')).toBe('1')
    expect(await c.get('c')).toBe('3')
    expect(c.size()).toBe(2)
  })

  it('delete removes entries', async () => {
    const c = new LruCache()
    await c.set('k', 'v', 60)
    await c.delete('k')
    expect(await c.get('k')).toBeNull()
  })
})

describe('cacheKey + argDigest', () => {
  it('cacheKey produces the canonical prefix format', () => {
    const k = cacheKey({
      chainId: 84532,
      contract: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
      fn: 'reputation.getSummary',
      args: 'deadbeef',
    })
    expect(k).toBe('erc8004:84532:0x8004b663056a597dffe9eccc1965a193b7388713:reputation.getSummary:deadbeef')
  })

  it('argDigest is deterministic for the same inputs (including bigints)', async () => {
    const a = await argDigest([1n, 'x', ['0xaa']])
    const b = await argDigest([1n, 'x', ['0xaa']])
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('argDigest differs for different inputs', async () => {
    const a = await argDigest([1n])
    const b = await argDigest([2n])
    expect(a).not.toBe(b)
  })
})
