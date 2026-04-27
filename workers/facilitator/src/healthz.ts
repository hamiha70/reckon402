import type { Context } from 'hono'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import type { Env } from './env.js'
import { SPLITTER_ABI } from './abi/splitter.js'

type ProbeResult = { ok: boolean; latency_ms: number; error?: string }

async function probe<T>(fn: () => Promise<T>, timeoutMs = 5_000): Promise<ProbeResult> {
  const start = Date.now()
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    return { ok: true, latency_ms: Date.now() - start }
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: (err as Error).message }
  }
}

/**
 * GET /healthz — design pack 02_facilitator.md §13.
 *
 * Checks at L3: d1_read, d1_write, base_rpc_primary, base_rpc_fallback,
 * splitter_contract (calls token() view). Signing wrapper + ERC-8004 are
 * L4. Aggregate status: `ok` if all pass; `degraded` if non-critical fails;
 * `down` if d1_read or both RPCs fail.
 */
export async function healthzHandler(c: Context<{ Bindings: Env }>) {
  const checks: Record<string, ProbeResult> = {}

  checks.d1_read = await probe(() => c.env.DB.prepare('SELECT 1').first())

  checks.d1_write = await probe(() =>
    c.env.DB
      .prepare(`INSERT OR IGNORE INTO _healthz_probe (k, v) VALUES (?1, ?2)`)
      .bind(crypto.randomUUID(), Date.now())
      .run(),
  )

  if (c.env.BASE_SEPOLIA_RPC_PRIMARY) {
    const primary = createPublicClient({
      chain: baseSepolia,
      transport: http(c.env.BASE_SEPOLIA_RPC_PRIMARY),
    })
    checks.base_rpc_primary = await probe(() => primary.getBlockNumber())
  } else {
    checks.base_rpc_primary = { ok: false, latency_ms: 0, error: 'unconfigured' }
  }

  if (c.env.BASE_SEPOLIA_RPC_FALLBACK) {
    const fallback = createPublicClient({
      chain: baseSepolia,
      transport: http(c.env.BASE_SEPOLIA_RPC_FALLBACK),
    })
    checks.base_rpc_fallback = await probe(() => fallback.getBlockNumber())
  } else {
    checks.base_rpc_fallback = { ok: false, latency_ms: 0, error: 'unconfigured' }
  }

  if (c.env.SPLITTER_ADDRESS && c.env.BASE_SEPOLIA_RPC_PRIMARY) {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(c.env.BASE_SEPOLIA_RPC_PRIMARY),
    })
    checks.splitter_contract = await probe(() =>
      client.readContract({
        address: c.env.SPLITTER_ADDRESS as `0x${string}`,
        abi: SPLITTER_ABI,
        functionName: 'token',
      }),
    )
  } else {
    checks.splitter_contract = { ok: false, latency_ms: 0, error: 'unconfigured' }
  }

  const critical = checks.d1_read.ok && (checks.base_rpc_primary.ok || checks.base_rpc_fallback.ok)
  const allOk = Object.values(checks).every((r) => r.ok)
  const status = !critical ? 'down' : allOk ? 'ok' : 'degraded'

  return c.json(
    {
      status,
      layer: 'L3',
      checks,
      timestamp: Date.now(),
    },
    status === 'down' ? 503 : 200,
  )
}
