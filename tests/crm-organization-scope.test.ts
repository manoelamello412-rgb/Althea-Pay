import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CRM organization scope foundation', () => {
  const migration = readFileSync(
    'supabase/migrations/20260919205429_crm_organization_scope_foundation.sql',
    'utf8',
  )

  it('adds canonical organization scope to CRM owner-attributed tables', () => {
    for (const table of [
      'crm_conversations',
      'crm_messages',
      'crm_agents',
      'crm_teams',
      'crm_team_members',
      'crm_tasks',
      'crm_tags',
      'crm_quick_replies',
      'crm_channel_accounts',
      'crm_channel_message_outbox',
      'crm_webhook_events',
    ]) {
      expect(migration).toContain(`'${table}'`)
    }
  })

  it('backfills from the user default organization and rejects unresolved rows', () => {
    expect(migration).toContain('p.default_organization_id')
    expect(migration).toContain('CRM_ORGANIZATION_BACKFILL_FAILED')
    expect(migration).toContain('alter column organization_id set not null')
  })

  it('prevents cross-organization reassignment and membership mismatch', () => {
    expect(migration).toContain('CRM_ORGANIZATION_IMMUTABLE')
    expect(migration).toContain('CRM_USER_ORGANIZATION_MISMATCH')
    expect(migration).toContain('organization_members')
  })

  it('does not replace CRM RLS in this additive stage', () => {
    expect(migration).not.toMatch(/create\s+policy\s+crm_/i)
    expect(migration).not.toMatch(/drop\s+policy\s+crm_/i)
  })
})
