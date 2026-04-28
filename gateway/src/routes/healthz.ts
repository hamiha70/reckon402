import { type Context } from 'hono'
import type { Env } from '../env.js'
import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'

interface ProbeResult {
  ok: boolean
  latency_ms: number
  error?: string
}

async function probe(name: string, fn: () => Promise<unknown>): Promise<[string, ProbeResult]> {
  const start = Date.now()
  try {
    await fn()
    return [name, { ok: true, latency_ms: Date.now() - start }]
  } catch (err) {
    return [name, { ok: false, latency_ms: Date.now() - start, error: String(err) }]
  }
}

export async function healthzHandler(c: Context<{ Bindings: Env }>) {
  const env = c.env

  const [d1Result, signerResult, rpcResult] = await Promise.all([
    probe('d1_records', async () => {
      const row = await env.DB.prepare('SELECT v FROM _healthz_probe WHERE k = ?').bind('ok').first()
      if (!row) throw new Error('healthz probe row missing')
    }),
    probe('signing_key_loaded', async () => {
      if (!env.RECKON402_RESOLVER_SIGNER_PK || env.RECKON402_RESOLVER_SIGNER_PK.length < 10) {
        throw new Error('RECKON402_RESOLVER_SIGNER_PK not set')
      }
    }),
    probe('eth_sepolia_rpc', async () => {
      if (!env.ETH_SEPOLIA_RPC) throw new Error('ETH_SEPOLIA_RPC not set')
      const client = createPublicClient({ chain: sepolia, transport: http(env.ETH_SEPOLIA_RPC) })
      await client.getBlockNumber()
    }),
  ])

  const checks: Record<string, ProbeResult> = {
    [d1Result[0]]:    d1Result[1],
    [signerResult[0]]: signerResult[1],
    [rpcResult[0]]:   rpcResult[1],
  }

  const coreOk = checks['d1_records'].ok && checks['signing_key_loaded'].ok
  const status = coreOk
    ? (checks['eth_sepolia_rpc'].ok ? 'ok' : 'degraded')
    : 'down'

  return c.json(
    {
      status,
      checks,
      env_flags: {
        ENABLE_ERC8004_READS: env.ENABLE_ERC8004_READS,
        STEALTH_ENABLED:      env.STEALTH_ENABLED,
      },
    },
    status === 'down' ? 503 : 200,
  )
}
