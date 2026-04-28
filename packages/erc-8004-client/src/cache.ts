import type { KVCache } from './types.js'

export class NoopCache implements KVCache {
  async get(_key: string): Promise<string | null> {
    return null
  }
  async set(_key: string, _value: string, _ttlSeconds: number): Promise<void> {
    // no-op
  }
  async delete(_key: string): Promise<void> {
    // no-op
  }
}

interface LruEntry {
  value: string
  expiresAt: number
}

export interface LruCacheOptions {
  max?: number
  now?: () => number
}

export class LruCache implements KVCache {
  private readonly max: number
  private readonly now: () => number
  private readonly store = new Map<string, LruEntry>()

  constructor(options: LruCacheOptions = {}) {
    this.max = options.max ?? 1000
    this.now = options.now ?? (() => Date.now())
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key)
      return null
    }
    // LRU bump: re-insert to move to tail.
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = this.now() + ttlSeconds * 1000
    if (this.store.has(key)) this.store.delete(key)
    this.store.set(key, { value, expiresAt })
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  size(): number {
    return this.store.size
  }
}

/**
 * Canonical cache-key format used by library reads. Consumers that
 * mirror cache entries (e.g. the gateway's D1 cache) MUST use the
 * same format or invalidation hooks won't match.
 */
export function cacheKey(parts: {
  chainId: number
  contract: string
  fn: string
  args: string
}): string {
  return `erc8004:${parts.chainId}:${parts.contract.toLowerCase()}:${parts.fn}:${parts.args}`
}

/**
 * Deterministic argument digest: plain string for compactness.
 * Uses WebCrypto SHA-256 which is available in both Node (≥20) and
 * Cloudflare Workers runtime.
 */
export async function argDigest(args: unknown): Promise<string> {
  const json = JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v))
  const bytes = new TextEncoder().encode(json)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex
}
