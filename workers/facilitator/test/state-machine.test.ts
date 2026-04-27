import { describe, it, expect } from 'vitest'
import { assertTransition, isTerminal, type ReceiptState } from '../src/state-machine.js'

const allStates: ReceiptState[] = [
  'SUBMITTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'RECONCILED',
  'FAILED',
]

const allowed: Array<[ReceiptState, ReceiptState]> = [
  ['SUBMITTED', 'PENDING_CONFIRMATION'],
  ['SUBMITTED', 'FAILED'],
  ['PENDING_CONFIRMATION', 'CONFIRMED'],
  ['PENDING_CONFIRMATION', 'FAILED'],
  ['PENDING_CONFIRMATION', 'PENDING_CONFIRMATION'],
  ['CONFIRMED', 'RECONCILED'],
]

describe('state machine', () => {
  it('accepts every documented transition', () => {
    for (const [from, to] of allowed) {
      expect(() => assertTransition(from, to)).not.toThrow()
    }
  })

  it('rejects every non-documented transition', () => {
    for (const from of allStates) {
      for (const to of allStates) {
        const isAllowed = allowed.some((t) => t[0] === from && t[1] === to)
        if (!isAllowed) {
          expect(() => assertTransition(from, to)).toThrow(/illegal state transition/)
        }
      }
    }
  })

  it('marks RECONCILED and FAILED as terminal; others as non-terminal', () => {
    expect(isTerminal('RECONCILED')).toBe(true)
    expect(isTerminal('FAILED')).toBe(true)
    expect(isTerminal('SUBMITTED')).toBe(false)
    expect(isTerminal('PENDING_CONFIRMATION')).toBe(false)
    expect(isTerminal('CONFIRMED')).toBe(false)
  })
})
