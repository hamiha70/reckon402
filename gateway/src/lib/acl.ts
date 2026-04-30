// Per-key writer table for L4c signed-writes (spec 08B §2).
// "Reckon402" keys are infrastructure — writable only by the Reckon402
// onboarding EOA. "SellingAgent" keys are merchant-owned — writable by the
// current owner(namehash(ensName)).
//
// During the bootstrap window (when owner(node) still equals the Reckon402
// onboarding EOA, i.e. subnode ownership has not yet been transferred to
// the SellingAgent), Reckon402 is also accepted for SellingAgent keys.
// This is the one-way door described in spec §4.2: ownership transfer
// closes the bootstrap window.

export type Writer = 'Reckon402' | 'SellingAgent'

export const WRITER_ACL: Readonly<Record<string, Writer>> = Object.freeze({
  'x402.splitter':           'Reckon402',
  'x402.facilitator':        'Reckon402',
  'x402.erc8004.registry':   'Reckon402',
  'x402.erc8004.agent_id':   'Reckon402',
  'x402.amount':             'SellingAgent',
  'x402.pricing':            'SellingAgent',
  'x402.endpoint':           'SellingAgent',
  'x402.attestation':        'SellingAgent',
  'x402.yield':              'SellingAgent',
  'x402.scheme':             'SellingAgent',
  'x402.version':            'SellingAgent',
  'x402.asset':              'SellingAgent',
})

/**
 * Returns the required writer role for a key, or null if the key is not in
 * the ACL (route returns 422 for unknown keys).
 */
export function requiredWriter(key: string): Writer | null {
  return WRITER_ACL[key] ?? null
}
