import { Hono } from 'hono'
import type { Env } from '../../src/env.js'
import { encodeAbiParameters, type Hex, encodeAbiParameters as eap } from 'viem'
import { lookupPost, lookupGet, lookupOptions } from '../../src/routes/lookup.js'
import { healthzHandler } from '../../src/routes/healthz.js'

// ─── Fake D1 ────────────────────────────────────────────────────────────────

export function makeFakeDb(
  merchants: Array<{ ens_name: string; enabled: number; records: Record<string, string> }> = [],
) {
  return {
    prepare(sql: string) {
      const bound: unknown[] = []
      const obj = {
        bind(...args: unknown[]) {
          bound.push(...args)
          return obj
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('_healthz_probe')) {
            return { v: 1 } as T
          }
          if (sql.includes('merchants')) {
            const name = bound[0] as string
            const row = merchants.find(m => m.ens_name === name)
            if (!row) return null
            return {
              ens_name: row.ens_name,
              enabled:  row.enabled,
              records:  JSON.stringify(row.records),
            } as T
          }
          return null
        },
      }
      return obj
    },
  }
}

// ─── Fake Env ────────────────────────────────────────────────────────────────

export function makeEnv(
  merchants: Array<{ ens_name: string; enabled: number; records: Record<string, string> }> = [],
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: makeFakeDb(merchants) as unknown as Env['DB'],
    RESOLVER_CONTRACT_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000001',
    ENABLE_ERC8004_READS: 'false',
    STEALTH_ENABLED: 'false',
    RECKON402_RESOLVER_SIGNER_PK: ('0x' + 'ab'.repeat(32)) as Hex,
    ETH_SEPOLIA_RPC: 'https://fake-rpc.example.com',
    ...overrides,
  }
}

// ─── Hono test app ───────────────────────────────────────────────────────────

export function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>()
  app.options('/lookup',     lookupOptions)
  app.options('/lookup/*',   lookupOptions)
  app.post('/lookup',              lookupPost)
  app.get('/lookup/:sender/:data', lookupGet)
  app.get('/healthz', healthzHandler)

  // Inject env into every request
  return {
    async request(method: string, path: string, body?: unknown): Promise<Response> {
      const init: RequestInit = { method }
      if (body !== undefined) {
        init.body = JSON.stringify(body)
        init.headers = { 'Content-Type': 'application/json' }
      }
      const req = new Request('http://localhost' + path, init)

      // Hono's fetch needs a context with env bindings injected
      // We use a middleware to inject env before the route handles it
      const appWithEnv = new Hono()
      appWithEnv.all('*', async (c, next) => {
        Object.assign(c.env, env)
        await next()
      })
      return app.fetch(req, env)
    },
  }
}

// ─── callData builders ───────────────────────────────────────────────────────

/** DNS wire-encode a name. */
export function dnsEncode(name: string): Hex {
  const labels = name.split('.')
  const parts: number[] = []
  for (const label of labels) {
    parts.push(label.length)
    for (const ch of label) parts.push(ch.charCodeAt(0))
  }
  parts.push(0)
  return ('0x' + parts.map(b => b.toString(16).padStart(2, '0')).join('')) as Hex
}

/** Build the ABI-encoded callData as Reckon402Resolver.resolve() produces. */
export function buildCallData(
  ensName: string,
  callerAddr: `0x${string}`,
  key: string,
): Hex {
  const encodedName = dnsEncode(ensName)

  // innerData = text(bytes32 node, string key) call
  const selector = '0x59d1d43c'
  const node = ('0x' + '00'.repeat(32)) as Hex
  const args = encodeAbiParameters(
    [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
    [node, key],
  )
  const innerData = (selector + args.slice(2)) as Hex

  return encodeAbiParameters(
    [
      { name: 'name',       type: 'bytes'   },
      { name: 'callerAddr', type: 'address' },
      { name: 'innerData',  type: 'bytes'   },
    ],
    [encodedName, callerAddr, innerData],
  )
}
