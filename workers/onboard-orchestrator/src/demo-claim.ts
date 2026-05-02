/**
 * POST /demo/claim — server-side Escrow.withdrawAll() for the H-9 demo.
 *
 * Replaces the dashboard's MetaMask-based claim flow with a single server
 * round-trip: the frontend tells us "claim from this Escrow", we sign +
 * broadcast withdrawAll() with the seller's hot key (SELLER_PK from
 * Infisical → wrangler secret), and return the tx hash.
 *
 * Why this exists:
 *   - The recording flow needs to demonstrate a withdraw without forcing
 *     the operator to import a PK into MetaMask, switch chains, sign, etc.
 *     That ceremony is recording-fragile and consumes screen time better
 *     spent on the on-chain payoff.
 *   - The Escrow contract enforces withdrawAll() = msg.sender must be the
 *     agentId NFT owner (= seller EOA). Same security model as MetaMask
 *     — the difference is only WHERE the signer lives. For a hackathon
 *     submission with a single demo seller EOA, server-hosted is fine.
 *
 * Production caveat: this endpoint is NOT a production signing surface.
 * It's hardwired to a single SELLER_PK and any caller can drain the
 * Escrow's released amount to that fixed seller address. Acceptable for
 * the hackathon (test-net only, 0.01 USDC per call, fixed demo wallet);
 * post-submission this would move behind real auth and per-NFT-owner
 * delegation if it survived as a real product surface at all.
 */
import type { Context } from 'hono'
import { createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { nonceManager } from 'viem/nonce'
import { baseSepolia } from 'viem/chains'
import type { Env } from './env.js'

const WITHDRAW_ALL_SELECTOR: Hex = '0x853828b6' // Escrow.withdrawAll() — no args

interface ClaimRequest {
  escrowAddress?: unknown
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function demoClaimOptions(_c: Context<{ Bindings: Env }>) {
  return new Response(null, { status: 204, headers: CORS })
}

export async function demoClaimHandler(c: Context<{ Bindings: Env }>) {
  let body: ClaimRequest
  try {
    body = (await c.req.json()) as ClaimRequest
  } catch {
    return c.json({ error: 'malformed_json' }, 400, CORS)
  }

  const escrowAddress = typeof body.escrowAddress === 'string' ? body.escrowAddress : ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
    return c.json({ error: 'invalid_escrow_address', got: escrowAddress }, 422, CORS)
  }

  // Both SELLER_PK and BASE_SEPOLIA_RPC_PRIMARY are required for any
  // chance of a successful broadcast. Surface a clean 503 instead of a
  // viem internal error if either is missing.
  if (!c.env.SELLER_PK) {
    return c.json({
      error:  'demo_not_configured',
      detail: 'SELLER_PK secret missing — configure via `wrangler secret put SELLER_PK`',
    }, 503, CORS)
  }
  if (!c.env.BASE_SEPOLIA_RPC_PRIMARY) {
    return c.json({
      error:  'demo_not_configured',
      detail: 'BASE_SEPOLIA_RPC_PRIMARY secret missing',
    }, 503, CORS)
  }

  const account = privateKeyToAccount(c.env.SELLER_PK as Hex, { nonceManager })
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(c.env.BASE_SEPOLIA_RPC_PRIMARY, { timeout: 60_000 }),
  })

  let txHash: Hex
  try {
    txHash = await wallet.sendTransaction({
      to:   escrowAddress as `0x${string}`,
      data: WITHDRAW_ALL_SELECTOR,
    })
  } catch (err) {
    return c.json({
      error:         'broadcast_failed',
      detail:        (err as Error).message,
      escrowAddress,
      sellerAddress: account.address,
    }, 502, CORS)
  }

  return c.json({
    ok:            true,
    txHash,
    basescanUrl:   `https://sepolia.basescan.org/tx/${txHash}`,
    escrowAddress,
    sellerAddress: account.address,
  }, 200, CORS)
}
