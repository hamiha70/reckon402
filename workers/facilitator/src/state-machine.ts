/**
 * Minimum-viable X35 state machine for L3.
 * Source: design pack 02_facilitator.md §6.1 transition table.
 *
 * MUST-implement at L3: SUBMITTED, PENDING_CONFIRMATION, CONFIRMED, FAILED.
 * RECONCILED is reachable only via Splitter Distributed event observation
 * (L4 reconciler). CHECKPOINT is not in the design pack table.
 */

export type ReceiptState =
  | 'SUBMITTED'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'RECONCILED'
  | 'FAILED'
  // L4c: terminal rejection when the SellingAgent's Splitter cannot be
  // resolved from the gateway (missing/forged `x402.splitter` record, or
  // factory `isDeployed` check fails). Reached only from SUBMITTED, before
  // any on-chain tx. Not in the reconciler's sweep scope.
  | 'SPLITTER_UNKNOWN'

const ALLOWED_TRANSITIONS: Record<ReceiptState, ReceiptState[]> = {
  SUBMITTED: ['PENDING_CONFIRMATION', 'FAILED', 'SPLITTER_UNKNOWN'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'FAILED', 'PENDING_CONFIRMATION'], // self-loop on /reconcile indeterminate
  CONFIRMED: ['RECONCILED'],
  RECONCILED: [],
  FAILED: [],
  SPLITTER_UNKNOWN: [],
}

export function assertTransition(from: ReceiptState, to: ReceiptState): void {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`illegal state transition: ${from} -> ${to}`)
  }
}

export function isTerminal(state: ReceiptState): boolean {
  return state === 'RECONCILED' || state === 'FAILED' || state === 'SPLITTER_UNKNOWN'
}
