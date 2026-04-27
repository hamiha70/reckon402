import { describe, it, expect } from 'vitest'
import worker from '../src/index'

const fetch = (path: string) =>
  worker.fetch(new Request(`https://agent.reckon402.com${path}`), {} as never, {} as never)

describe('GET /health', () => {
  it('returns 200 with ok status at layer L2', async () => {
    const res = await fetch('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', layer: 'L2' })
  })
})

describe('GET /research', () => {
  it('returns 402 without PAYMENT-SIGNATURE header', async () => {
    const res = await fetch('/research?q=ethereum')
    expect(res.status).toBe(402)
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull()
  })

  it('returns 402 for request without q param', async () => {
    const res = await fetch('/research')
    expect(res.status).toBe(402)
  })
})
