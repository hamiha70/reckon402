import { type Context } from 'hono'
import type { Env } from '../env.js'
import { decodeCallData, dnsDecodeName, decodeTextKey } from '../ccip/decode.js'
import { encodeTextResult } from '../ccip/encode.js'
import { signCcipResponse } from '../ccip/sign.js'
import { resolveRecord } from '../resolution/dispatch.js'
import { GatewayError, errorToStatus } from '../lib/errors.js'
import type { Hex } from 'viem'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/**
 * Core handler shared by POST /lookup and GET /lookup/:sender/:data.
 * `sender` is the resolver contract address (EIP-3668 semantics).
 * `data` is the ABI-encoded callData from the OffchainLookup revert.
 */
async function handleLookup(
  sender: string,
  data: Hex,
  extraData: Hex,
  env: Env,
): Promise<{ data: Hex }> {
  const decoded     = decodeCallData(data)
  const ensName     = dnsDecodeName(decoded.name)
  const key         = decodeTextKey(decoded.innerData)

  const value       = await resolveRecord(ensName, key, env)

  const resultBytes = encodeTextResult(value)
  const response    = await signCcipResponse(resultBytes, extraData, env.RECKON402_RESOLVER_SIGNER_PK as Hex)

  return { data: response }
}

export async function lookupPost(c: Context<{ Bindings: Env }>) {
  try {
    let body: { sender?: string; data?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { code: 'MALFORMED_CALL_DATA', message: 'Invalid JSON body' } }, 400, CORS_HEADERS)
    }

    if (!body.sender || !body.data) {
      return c.json({ error: { code: 'MALFORMED_CALL_DATA', message: 'Missing sender or data' } }, 400, CORS_HEADERS)
    }

    const data      = body.data as Hex
    const extraData = data  // resolver echoes callData as extraData

    const result = await handleLookup(body.sender, data, extraData, c.env)
    return c.json(result, 200, CORS_HEADERS)
  } catch (err) {
    if (err instanceof GatewayError) {
      return c.json({ error: { code: err.code, message: err.message } }, errorToStatus(err.code), CORS_HEADERS)
    }
    if (err instanceof Error && err.message === 'NOT_IMPLEMENTED — see L4a₂') {
      return c.json({ error: { code: 'NOT_IMPLEMENTED', message: err.message } }, 501, CORS_HEADERS)
    }
    console.error('[lookup] unexpected error:', err)
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500, CORS_HEADERS)
  }
}

export async function lookupGet(c: Context<{ Bindings: Env }>) {
  try {
    const sender = c.req.param('sender')
    const data   = c.req.param('data') as Hex

    if (!sender || !data) {
      return c.json({ error: { code: 'MALFORMED_CALL_DATA', message: 'Missing sender or data path params' } }, 400, CORS_HEADERS)
    }

    const extraData = data

    const result = await handleLookup(sender, data, extraData, c.env)
    return c.json(result, 200, CORS_HEADERS)
  } catch (err) {
    if (err instanceof GatewayError) {
      return c.json({ error: { code: err.code, message: err.message } }, errorToStatus(err.code), CORS_HEADERS)
    }
    if (err instanceof Error && err.message === 'NOT_IMPLEMENTED — see L4a₂') {
      return c.json({ error: { code: 'NOT_IMPLEMENTED', message: err.message } }, 501, CORS_HEADERS)
    }
    console.error('[lookup] unexpected error:', err)
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500, CORS_HEADERS)
  }
}

export async function lookupOptions(c: Context<{ Bindings: Env }>) {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
