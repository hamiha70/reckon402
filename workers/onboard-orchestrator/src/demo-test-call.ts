/**
 * POST /demo/test-call — server-side x402 buyer flow for the H-9 demo.
 *
 * Replaces the dashboard's "Run Test Call" button (which previously linked
 * to a KeeperHub workflow that we couldn't get authenticated in the
 * recording window) with a single round-trip:
 *   1. GET https://agent.reckon402.com/<label>/research?q=…  → 402 challenge
 *   2. Sign EIP-3009 TransferWithAuthorization with BUYER_DEMO_1_PK
 *      (Infisical → wrangler secret) using the @reckon402/buyer-sdk path
 *      (same code as tools/integration-tests/buyer-sign-l3.mjs).
 *   3. GET the same URL with the payment-signature header → 200 + receipt.
 *   4. Return paymentId + transferTx + settled state to the frontend so
 *      the dashboard can render the in-flight call and link to Basescan.
 *
 * Why this exists:
 *   - The recording flow needs to demonstrate a real on-chain settlement
 *     without dropping into a terminal mid-Act-4. One button, one tx.
 *   - The buyer side stays a real EIP-3009 signature (from a fixed demo
 *     buyer EOA), the facilitator stays the live facilitator.reckon402.com,
 *     the agent stays agent.reckon402.com — only the trigger surface
 *     changes. End-to-end this is the same code path as `just fullflow-l4b`,
 *     just initiated from the Worker instead of bash.
 *
 * Production caveat: this endpoint is publicly callable and pays out of a
 * fixed buyer EOA's USDC balance (BUYER_DEMO_1, 20 USDC capped). Anyone
 * who hits it can drain that balance one 0.01-USDC settlement at a time.
 * Acceptable for the hackathon (test-net + low ceiling); not a production
 * surface.
 */
import type { Context } from 'hono'
import { signPayment, encodeXPaymentHeader } from '@reckon402/buyer-sdk'
import type { Env } from './env.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const AGENT_BASE_URL = 'https://agent.reckon402.com'
const ENS_LABEL_RE   = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.reckon402-test\.eth$/

interface TestCallRequest {
  ensName?: unknown
  query?:   unknown
}

interface PaymentRequiredChallenge {
  x402Version: number
  accepts: Array<{
    network:  string
    amount:   string
    asset:    string
    payTo:    string
    extra?:   { name?: string; version?: string; ens?: string }
  }>
}

interface SettlementResponseBlob {
  transaction?: string
  state?:       string
  paymentId?:   string
  network?:     string
}

export async function demoTestCallOptions(_c: Context<{ Bindings: Env }>) {
  return new Response(null, { status: 204, headers: CORS })
}

export async function demoTestCallHandler(c: Context<{ Bindings: Env }>) {
  let body: TestCallRequest
  try {
    body = (await c.req.json()) as TestCallRequest
  } catch {
    return c.json({ error: 'malformed_json' }, 400, CORS)
  }

  const ensName = typeof body.ensName === 'string' ? body.ensName : ''
  const query   = typeof body.query   === 'string' && body.query.length > 0 ? body.query : 'demo call'

  const m = ensName.match(ENS_LABEL_RE)
  if (!m) {
    return c.json({
      error:  'invalid_ens_name',
      detail: 'expected <label>.reckon402-test.eth',
      got:    ensName,
    }, 422, CORS)
  }
  const label = m[1]!

  if (!c.env.BUYER_DEMO_1_PK) {
    return c.json({
      error:  'demo_not_configured',
      detail: 'BUYER_DEMO_1_PK secret missing — configure via `wrangler secret put BUYER_DEMO_1_PK`',
    }, 503, CORS)
  }

  const url = `${AGENT_BASE_URL}/${label}/research?q=${encodeURIComponent(query)}`

  // ─── Step 1: GET → 402 challenge ────────────────────────────────────────
  let challengeRes: Response
  try {
    challengeRes = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    return c.json({
      error:  'agent_unreachable',
      detail: (err as Error).message,
      url,
    }, 502, CORS)
  }
  if (challengeRes.status !== 402) {
    const text = await challengeRes.text().catch(() => '')
    return c.json({
      error:  'unexpected_challenge_status',
      detail: `expected 402 from agent, got ${challengeRes.status}`,
      body:   text.slice(0, 500),
    }, 502, CORS)
  }

  const prHeader = challengeRes.headers.get('PAYMENT-REQUIRED')
  if (!prHeader) {
    return c.json({ error: 'missing_payment_required_header' }, 502, CORS)
  }
  let challenge: PaymentRequiredChallenge
  try {
    challenge = JSON.parse(atob(prHeader)) as PaymentRequiredChallenge
  } catch {
    return c.json({ error: 'malformed_payment_required_header' }, 502, CORS)
  }
  const accepted = challenge.accepts?.[0]
  if (!accepted) {
    return c.json({ error: 'no_accepts_in_challenge' }, 502, CORS)
  }
  // We only support eip155:84532 (Base Sepolia) for this demo endpoint.
  // The agent worker's resolved network is pinned to its own NETWORK var,
  // which is also Base Sepolia, so this is a defensive guard rather than
  // an expected branch.
  const chainIdMatch = accepted.network.match(/^eip155:(\d+)$/)
  if (!chainIdMatch) {
    return c.json({ error: 'unsupported_network', got: accepted.network }, 502, CORS)
  }
  const chainId = Number(chainIdMatch[1]!)
  if (chainId !== 84532) {
    return c.json({ error: 'unsupported_chain_id', got: chainId, expected: 84532 }, 502, CORS)
  }

  // ─── Step 2: sign EIP-3009 ─────────────────────────────────────────────
  const signed = await signPayment({
    privateKey:  c.env.BUYER_DEMO_1_PK as `0x${string}`,
    recipient:   accepted.payTo as `0x${string}`,
    amount:      accepted.amount,
    network:     accepted.network,
    usdcAddress: accepted.asset as `0x${string}`,
    chainId,
    resourceUrl: url,
  })
  const paymentHeader = encodeXPaymentHeader(signed.payload)

  // ─── Step 3: GET with payment header → 200 + receipt ───────────────────
  let settleRes: Response
  try {
    settleRes = await fetch(url, {
      method:  'GET',
      headers: { 'payment-signature': paymentHeader },
      signal:  AbortSignal.timeout(60_000),
    })
  } catch (err) {
    return c.json({
      error:     'settle_request_failed',
      detail:    (err as Error).message,
      paymentId: signed.paymentId,
    }, 502, CORS)
  }

  const responseHeader = settleRes.headers.get('PAYMENT-RESPONSE')
  let settled: SettlementResponseBlob = {}
  if (responseHeader) {
    try { settled = JSON.parse(atob(responseHeader)) as SettlementResponseBlob } catch { /* swallow */ }
  }

  let bodyJson: unknown = null
  let bodyText: string | null = null
  try {
    bodyJson = await settleRes.clone().json()
  } catch {
    try { bodyText = await settleRes.text() } catch { bodyText = null }
  }

  return c.json({
    ok:           settleRes.status === 200,
    httpStatus:   settleRes.status,
    paymentId:    signed.paymentId,
    nonce:        signed.authorization.nonce,
    transferTx:   settled.transaction ?? null,
    settledState: settled.state ?? null,
    settled,
    body:         bodyJson ?? bodyText,
    paywall: {
      payTo:  accepted.payTo,
      amount: accepted.amount,
      asset:  accepted.asset,
      ens:    accepted.extra?.ens ?? ensName,
    },
    basescanUrl: settled.transaction
      ? `https://sepolia.basescan.org/tx/${settled.transaction}`
      : null,
  }, settleRes.status === 200 ? 200 : 502, CORS)
}
