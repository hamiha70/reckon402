import type { D1Database } from '@cloudflare/workers-types'
import type { OnboardStep, OnboardResult } from '@reckon402/onboard'

export type OnboardProgressStatus = 'running' | 'succeeded' | 'failed'

export interface OnboardProgressRow {
  onboard_id:   string
  ens_name:     string
  seller_eoa:   string
  status:       OnboardProgressStatus
  steps_json:   string
  result_json:  string | null
  started_at:   number
  updated_at:   number
}

export interface OnboardProgress {
  onboardId:   string
  ensName:     string
  sellerEoa:   `0x${string}`
  status:      OnboardProgressStatus
  steps:       OnboardStep[]
  result:      (Omit<OnboardResult, 'agentId'> & { agentId: string }) | null
  startedAt:   number
  updatedAt:   number
}

export class ProgressStore {
  constructor(private readonly db: D1Database) {}

  async create(onboardId: string, ensName: string, sellerEoa: `0x${string}`): Promise<void> {
    const now = Date.now()
    await this.db
      .prepare(
        `INSERT INTO onboard_progress
           (onboard_id, ens_name, seller_eoa, status, steps_json, result_json, started_at, updated_at)
         VALUES (?1, ?2, ?3, 'running', '[]', NULL, ?4, ?4)`,
      )
      .bind(onboardId, ensName, sellerEoa, now)
      .run()
  }

  async recordStep(onboardId: string, step: OnboardStep): Promise<void> {
    // Read-modify-write: pull the current steps array, upsert this step by id,
    // re-serialize.
    const row = await this.db
      .prepare('SELECT steps_json FROM onboard_progress WHERE onboard_id = ?1')
      .bind(onboardId)
      .first<{ steps_json: string }>()
    if (!row) return
    let steps: OnboardStep[] = []
    try { steps = JSON.parse(row.steps_json) } catch { steps = [] }
    const idx = steps.findIndex(s => s.id === step.id)
    if (idx >= 0) steps[idx] = step
    else steps.push(step)
    await this.db
      .prepare(`UPDATE onboard_progress SET steps_json = ?1, updated_at = ?2 WHERE onboard_id = ?3`)
      .bind(JSON.stringify(steps), Date.now(), onboardId)
      .run()
  }

  async complete(onboardId: string, result: OnboardResult): Promise<void> {
    const resultJson = JSON.stringify({ ...result, agentId: result.agentId.toString() })
    await this.db
      .prepare(
        `UPDATE onboard_progress
           SET status = 'succeeded', result_json = ?1, updated_at = ?2
         WHERE onboard_id = ?3`,
      )
      .bind(resultJson, Date.now(), onboardId)
      .run()
  }

  async fail(onboardId: string, error: string): Promise<void> {
    // Append the error onto the last step (steps array is already updated via
    // recordStep from the orchestrator's progressSink).
    await this.db
      .prepare(
        `UPDATE onboard_progress
           SET status = 'failed', result_json = ?1, updated_at = ?2
         WHERE onboard_id = ?3`,
      )
      .bind(JSON.stringify({ error }), Date.now(), onboardId)
      .run()
  }

  async get(onboardId: string): Promise<OnboardProgress | null> {
    const row = await this.db
      .prepare(
        `SELECT onboard_id, ens_name, seller_eoa, status, steps_json, result_json, started_at, updated_at
           FROM onboard_progress WHERE onboard_id = ?1`,
      )
      .bind(onboardId)
      .first<OnboardProgressRow>()
    if (!row) return null

    let steps: OnboardStep[] = []
    try { steps = JSON.parse(row.steps_json) } catch {}
    let result: OnboardProgress['result'] = null
    if (row.result_json) {
      try { result = JSON.parse(row.result_json) } catch {}
    }

    return {
      onboardId: row.onboard_id,
      ensName:   row.ens_name,
      sellerEoa: row.seller_eoa as `0x${string}`,
      status:    row.status,
      steps,
      result,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    }
  }
}

/**
 * Generate a short, URL-safe onboard id. Not cryptographic — just enough to
 * avoid collisions across concurrent onboardings (CF-Worker-level scope).
 */
export function generateOnboardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
