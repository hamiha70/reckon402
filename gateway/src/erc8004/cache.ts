import type { D1Database } from '@cloudflare/workers-types'
import type { KVCache } from '@reckon402/erc-8004-client'

/**
 * D1-backed KVCache implementation. Write-through; no negative
 * caching. On D1 errors (quota exceeded, transport blip), get()
 * returns null (forces fresh RPC) and set() logs a warning —
 * fall back to fresh-read mode rather than silently masking.
 */
export class D1Erc8004Cache implements KVCache {
  constructor(private readonly db: D1Database) {}

  async get(key: string): Promise<string | null> {
    try {
      const row = await this.db
        .prepare(
          'SELECT value_json FROM erc8004_cache WHERE cache_key = ? AND expires_at > ?',
        )
        .bind(key, Date.now())
        .first<{ value_json: string }>()
      return row?.value_json ?? null
    } catch (err) {
      console.warn('[erc8004_cache.get] D1 error; falling back to fresh read', err)
      return null
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000
    try {
      await this.db
        .prepare(
          `INSERT INTO erc8004_cache (cache_key, value_json, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             value_json = excluded.value_json,
             expires_at = excluded.expires_at`,
        )
        .bind(key, value, expiresAt)
        .run()
    } catch (err) {
      console.warn('[erc8004_cache.set] D1 error; skipping cache write', err)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.db.prepare('DELETE FROM erc8004_cache WHERE cache_key = ?').bind(key).run()
    } catch (err) {
      console.warn('[erc8004_cache.delete] D1 error; cache may still contain stale entry', err)
    }
  }

  /**
   * Prefix-based delete used by the cache-invalidate hook. Deletes
   * every row whose `cache_key` starts with `prefix`.
   *
   * Implemented via `substr(cache_key, 1, N) = prefix` rather than
   * `LIKE 'prefix%'` because D1's underlying SQLite rejects long LIKE
   * patterns containing multiple literal special characters (`0x`,
   * `:`, `.`) with `SQLITE_ERROR [7500]: LIKE or GLOB pattern too
   * complex`. Canonical cache keys always contain those three so LIKE
   * is never reliable here.
   *
   * Returns the number of rows deleted (-1 on D1 error).
   */
  async deletePattern(prefix: string): Promise<number> {
    try {
      const result = await this.db
        .prepare('DELETE FROM erc8004_cache WHERE substr(cache_key, 1, ?) = ?')
        .bind(prefix.length, prefix)
        .run()
      return result.meta.changes ?? 0
    } catch (err) {
      console.warn('[erc8004_cache.deletePattern] D1 error', err)
      return -1
    }
  }
}
