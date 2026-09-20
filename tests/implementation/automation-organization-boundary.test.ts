import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const enginePath = 'supabase/functions/automation-engine-v2/index.ts'
const eventWorkerPath = 'supabase/functions/event-worker/index.ts'
const webhookPath = 'supabase/functions/althea-webhook/index.ts'

describe('automation organization boundary contract', () => {
  it('requires and preserves organization_id in the canonical context', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('requireUuid(b.organization_id, "invalid_organization_id")')
    expect(source).toContain('await validateTenant(userId, organizationId)')
    expect(source).toMatch(/const c = \\{[\\s\\S]*?organization_id:\\s*organizationId/)
    expect(source).toMatch(/from\\("automation_rules"\\)[\\s\\S]*?eq\\("user_id",\\s*c\\.user_id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)[\\s\\S]*?eq\\("status",\\s*"active"\\)/)
    expect(source).toContain('RULE_ORGANIZATION_MISMATCH')
  })

  it('persists the organization explicitly in executions and input', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source.match(/from\\("automation_executions"\\)\\.insert\\(\\{/g)?.length).toBe(2)
    expect(source.match(/organization_id:\\s*c\\.organization_id/g)?.length).toBeGreaterThanOrEqual(4)
    expect(source).toContain('input: c')
    expect(source).toContain('crm_check_automation_rate_limit_org')
  })

  it('validates retry execution, rule and input within the same organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toMatch(/select\\("id,user_id,organization_id,rule_id,status,input,attempt_count,max_attempts"\\)/)
    expect(source).toMatch(/from\\("automation_rules"\\)[\\s\\S]*?eq\\("id",\\s*ex\\.rule_id\\)[\\s\\S]*?eq\\("user_id",\\s*ex\\.user_id\\)[\\s\\S]*?eq\\("organization_id",\\s*ex\\.organization_id\\)/)
    expect(source).toContain('RETRY_ORGANIZATION_MISMATCH')
    expect(source).toContain('RETRY_USER_MISMATCH')
  })

  it('keeps sale lookup and mutation organization-aware and rejects ambiguous external identifiers', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('SALE_EXTERNAL_ID_AMBIGUOUS_IN_ORGANIZATION')
    expect(source).toContain('SALE_NOT_FOUND_IN_ORGANIZATION')
    expect(source).toMatch(/from\\("sales"\\)[\\s\\S]*?eq\\("external_id",\\s*c\\.external_id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)[\\s\\S]*?limit\\(2\\)/)
    expect(source).toMatch(/from\\("sales"\\)[\\s\\S]*?update\\([\\s\\S]*?eq\\("id",\\s*sale\\.id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)/)
  })

  it('scopes checkout, conversations and agents by organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toMatch(/from\\("checkout_sessions"\\)[\\s\\S]*?eq\\("id",\\s*c\\.checkout_id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)/)
    expect(source).toMatch(/from\\("crm_conversations"\\)[\\s\\S]*?eq\\("id",\\s*conversationId\\)[\\s\\S]*?eq\\("user_id",\\s*c\\.user_id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)/)
    expect(source).toMatch(/from\\("crm_agents"\\)[\\s\\S]*?eq\\("id",\\s*assignedTo\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)/)
  })

  it('writes CRM messages and outbox rows with explicit organization context', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toMatch(/from\\("crm_messages"\\)\\.insert\\(\\{[\\s\\S]*?organization_id:\\s*c\\.organization_id/)
    expect(source).toMatch(/from\\("crm_channel_accounts"\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)/)
    expect(source).toMatch(/from\\("crm_channel_message_outbox"\\)\\.upsert\\(\\{[\\s\\S]*?organization_id:\\s*c\\.organization_id/)
  })

  it('namespaces stable keys and CRM idempotency by organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('\`\${c.organization_id}:\${String(explicit)}:\${ruleId}\`')
    expect(source).toContain('\`automation:\${c.organization_id}:\${rule.id}:\${identity}:\${channel}:\${hash}\`')
  })

  it('propagates organization_id from the event worker', async () => {
    const source = await readFile(eventWorkerPath, 'utf8')
    expect(source).toContain('id,user_id,organization_id,funnel_id,event_type')
    expect(source).toContain('organization_id: event.organization_id')
  })

  it('resolves the webhook organization and propagates it to events and automation', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toMatch(/from\\('webhook_integrations'\\)\\.select\\('organization_id'\\)/)
    expect(source).toContain('webhook_integration_organization_missing')
    expect(source).toContain('organization_id: organizationId')
    expect(source).toMatch(/automation-engine-v2[\\s\\S]*?organization_id:\\s*organizationId/)
  })
})
