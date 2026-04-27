import { describe, it, expect } from 'vitest'
import worker from '../src/index'

const fetch = (path: string) =>
  worker.fetch(new Request(`https://agent.reckon402.com${path}`), {} as never, {} as never)

describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await fetch('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', layer: 'L1' })
  })
})

describe('GET /research', () => {
  it('returns 200 with canned JSON when q is provided', async () => {
    const res = await fetch('/research?q=ethereum')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, string>
    expect(body.query).toBe('ethereum')
    expect(body.agent).toBe('reckon402-demo-research')
    expect(body.layer).toBe('L1')
    expect(typeof body.summary).toBe('string')
  })

  it('returns 400 when q is missing', async () => {
    const res = await fetch('/research')
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.error).toBe('q is required')
  })
})
