import { describe, test, expect } from 'vitest'
import { GatewayError, errorToStatus } from '../../src/lib/errors.js'

describe('GatewayError', () => {
  test('is instanceof Error', () => {
    const e = new GatewayError('MALFORMED_CALL_DATA', 'bad data')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(GatewayError)
  })

  test('preserves code and message', () => {
    const e = new GatewayError('UNKNOWN_NAME', 'not found')
    expect(e.code).toBe('UNKNOWN_NAME')
    expect(e.message).toBe('not found')
  })
})

describe('errorToStatus', () => {
  test('MALFORMED_CALL_DATA → 400', () => {
    expect(errorToStatus('MALFORMED_CALL_DATA')).toBe(400)
  })

  test('UNKNOWN_NAME → 400', () => {
    expect(errorToStatus('UNKNOWN_NAME')).toBe(400)
  })

  test('NOT_IMPLEMENTED → 501', () => {
    expect(errorToStatus('NOT_IMPLEMENTED')).toBe(501)
  })

  test('INTERNAL_ERROR → 500', () => {
    expect(errorToStatus('INTERNAL_ERROR')).toBe(500)
  })
})
