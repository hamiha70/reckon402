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

const ALLOWED_TRANSITIONS: Record<ReceiptState, ReceiptState[]> = {
  SUBMITTED: ['PENDING_CONFIRMATION', 'FAILED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'FAILED', 'PENDING_CONFIRMATION'], // self-loop on /reconcile indeterminate
  CONFIRMED: ['RECONCILED'],
  RECONCILED: [],
  FAILED: [],
}

export function assertTransition(from: ReceiptState, to: ReceiptState): void {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`illegal state transition: ${from} -> ${to}`)
  }
}

export function isTerminal(state: ReceiptState): boolean {
  return state === 'RECONCILED' || state === 'FAILED'
}
