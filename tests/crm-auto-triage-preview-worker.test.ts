import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(
  'supabase/functions/crm-auto-triage-preview/index.ts',
  'utf8',
)

describe('CRM automatic triage preview worker', () => {
  it('uses the deterministic triage router', () => {
    expect(worker).toContain(
      'import { decideAutoTriage } from "../_shared/crm-auto-triage.ts"',
    )
    expect(worker).toContain('decideAutoTriage({')
  })

  it('requires internal authentication and an explicit conversation', () => {
    expect(worker).toContain('x-althea-internal-secret')
    expect(worker).toContain('conversation_id_required')
  })

  it('is restricted to the configured organization and funnels', () => {
    expect(worker).toContain(
      'CRM_AUTO_TRIAGE_TARGET_ORGANIZATION_ID',
    )
    expect(worker).toContain(
      'CRM_AUTO_TRIAGE_TARGET_FUNNEL_IDS',
    )
    expect(worker).toContain(
      'conversation_outside_preview_scope',
    )
  })

  it('checks contact opt-out before triage', () => {
    const consentCheck = worker.indexOf(
      'crm_channel_recipient_opted_out',
    )
    const triageDecision = worker.indexOf(
      'decideAutoTriage({',
    )

    expect(consentCheck).toBeGreaterThan(-1)
    expect(triageDecision).toBeGreaterThan(consentCheck)
    expect(worker).toContain('recipient_opted_out')
    expect(worker).toContain('recipient_address_missing')
    expect(worker).toContain('consent_check_failed')
  })

  it('checks available agents by organization', () => {
    expect(worker).toContain('.from("crm_agents")')
    expect(worker).toContain(
      '.eq("organization_id", targetOrganizationId)',
    )
    expect(worker).toContain('.eq("status", "available")')
  })

  it('cannot insert interventions or queue messages', () => {
    expect(worker).not.toContain('.insert(')
    expect(worker).not.toContain(
      'iara_commercial_interventions',
    )
    expect(worker).not.toContain(
      'crm_channel_message_outbox',
    )
    expect(worker).toContain('wrote_to_database: false')
    expect(worker).toContain('queued_message: false')
    expect(worker).toContain('dry_run: true')
  })
})
