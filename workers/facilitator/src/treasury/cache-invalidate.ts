/**
 * Gateway cache-invalidate caller. See specs/07-l4b-erc8004-writes.md
 * §5.4 for rationale.
 *
 * Fires a POST to the L4a2 gateway's /hooks/cache-invalidate endpoint
 * to delete cached reputation reads for the agent whose attestation
 * was just written. Fire-and-forget: errors are logged, never
 * propagated. A failed cache-invalidate delays the visible count
 * increment by at most the cache TTL (300s) — not a correctness
 * problem, just a demo-visibility problem.
 */

export interface CacheInvalidateEnv {
  GATEWAY_CACHE_HOOK_URL: string
  GATEWAY_CACHE_HOOK_TOKEN?: string
}

export async function invalidateGatewayCache(
  env: CacheInvalidateEnv,
  args: { chainId: number; agentId: bigint },
): Promise<void> {
  if (!env.GATEWAY_CACHE_HOOK_TOKEN) {
    // No token → don't even try; the gateway would return 401 or 503.
    return
  }
  try {
    const res = await fetch(env.GATEWAY_CACHE_HOOK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GATEWAY_CACHE_HOOK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainId: args.chainId,
        agentId: args.agentId.toString(),
        keys: ['reputation.getClients', 'reputation.getSummary'],
      }),
    })
    if (!res.ok) {
      console.error('invalidateGatewayCache_non_2xx', { status: res.status })
    }
  } catch (err) {
    console.error('invalidateGatewayCache_fetch_failed', err)
  }
}
