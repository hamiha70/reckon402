import { describe, it, expect } from 'vitest'
import { createPublicClient, http, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { identity, reputation } from '../src/index.js'

/**
 * Live read against real Base Sepolia ERC-8004 contracts.
 *
 * Activated when BASE_SEPOLIA_RPC is set in the environment (via
 * `infisical run --env dev ... pnpm test`). Skipped silently
 * otherwise, so offline test runs stay green.
 *
 * Reference snapshot (2026-04-28):
 *  tools/integration-tests/known-agents.md
 *  - agentId=1 has 9 clients, untagged summary count=56
 *  - agentId=2 has 1 client, untagged summary count=1
 *
 * Reputation state is NOT promised stable; see known-agents.md swap
 * protocol if thresholds below start failing.
 */
declare const process: { env: Record<string, string | undefined> }
const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? process.env.BASE_SEPOLIA_RPC_PRIMARY

describe.skipIf(!RPC_URL)('reputation — live Base Sepolia read', () => {
  // Cast around the pnpm-dedup viem chain-parameterisation mismatch.
  // The library's readContract contract is identical across the duplicate
  // viem installs; only the Chain generic parameter drifts.
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL!, { timeout: 15_000 }),
  }) as unknown as PublicClient

  it('agentId=1 has the expected high-rep shape (clients ≥ 9, summary count ≥ 56)', async () => {
    const clients = await reputation.getClients({ chainId: 84532, publicClient, agentId: 1n })
    expect(clients.length).toBeGreaterThanOrEqual(9)
    const summary = await reputation.getSummary({
      chainId: 84532,
      publicClient,
      agentId: 1n,
      clientAddresses: clients,
      tag1: '',
      tag2: '',
    })
    expect(summary.count).toBeGreaterThanOrEqual(56n)
  })

  it('getSummaryForAllClients on agentId=2 returns count ≥ 1', async () => {
    const summary = await reputation.getSummaryForAllClients({
      chainId: 84532,
      publicClient,
      agentId: 2n,
      tag1: '',
      tag2: '',
    })
    expect(summary.count).toBeGreaterThanOrEqual(1n)
  })

  it('identity composite on agentId=1 returns the pinned owner', async () => {
    const agent = await identity.getAgent({ chainId: 84532, publicClient, agentId: 1n })
    expect(agent.owner.toLowerCase()).toBe('0x21fded74c901129977b8e28c2588595163e1e235')
    expect(agent.agentId).toBe(1n)
  })
})
