/**
 * Structured logger for Reckon402 Cloudflare Workers.
 *
 * All output goes to console.* so it appears in `wrangler tail`.
 * Format: [LEVEL] [component] message  key=value key=value
 *
 * Usage:
 *   import { makeLogger } from '@reckon402/logger'
 *   const log = makeLogger('settle')
 *   log.info('transfer_confirmed', { paymentId, tx, block })
 *   log.error('distribute_failed', { paymentId, detail: err.message })
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void
  info:  (event: string, fields?: Record<string, unknown>) => void
  warn:  (event: string, fields?: Record<string, unknown>) => void
  error: (event: string, fields?: Record<string, unknown>) => void
}

function fmt(level: LogLevel, component: string, event: string, fields?: Record<string, unknown>): string {
  const pairs = fields
    ? ' ' + Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : ''
  return `[${level}] [${component}] ${event}${pairs}`
}

const LEVEL_NUM: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

/**
 * Create a logger bound to a component name.
 * The minLevel controls which messages are emitted (default INFO).
 * Override via the LOG_LEVEL environment variable at call time if needed.
 */
export function makeLogger(component: string, minLevel: LogLevel = 'INFO'): Logger {
  function emit(level: LogLevel, event: string, fields?: Record<string, unknown>) {
    if (LEVEL_NUM[level] < LEVEL_NUM[minLevel]) return
    const msg = fmt(level, component, event, fields)
    if (level === 'ERROR') console.error(msg)
    else if (level === 'WARN')  console.warn(msg)
    else console.log(msg)
  }

  return {
    debug: (e, f) => emit('DEBUG', e, f),
    info:  (e, f) => emit('INFO',  e, f),
    warn:  (e, f) => emit('WARN',  e, f),
    error: (e, f) => emit('ERROR', e, f),
  }
}

/** Singleton for workers that don't need a named component. */
export const log = makeLogger('app')
