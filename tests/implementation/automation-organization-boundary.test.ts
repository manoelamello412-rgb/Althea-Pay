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
    expect(source).toContain('organization_id: organizationId')
    expect(source).toContain('.eq("user_id", c.user_id)')
    expect(source).toContain('.eq("organization_id", c.organization_id)')
    expect(source).toContain('.eq("status", "active")')
    expect(source).toContain('RULE_ORGANIZATION_MISMATCH')
  })

  it('persists the organization explicitly in executions and input', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source.split('db.from("automation_executions").insert({').length - 1).toBe(2)
    expect(source.split('organization_id: c.organization_id').length - 1).toBeGreaterThanOrEqual(4)
    expect(source).toContain('input: c')
    expect(source).toContain('crm_check_automation_rate_limit_org')
  })

  it('validates retry execution, rule and input within the same organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('id,user_id,organization_id,rule_id,status,input,attempt_count,max_attempts')
    expect(source).toContain('.eq("id", ex.rule_id)')
    expect(source).toContain('.eq("organization_id", ex.organization_id)')
    expect(source).toContain('RETRY_ORGANIZATION_MISMATCH')
    expect(source).toContain('RETRY_USER_MISMATCH')
  })

  it('routes sale mutation through the guarded tenant-aware server RPC', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('db.rpc("server_update_sale_status_v1"')
    expect(source).toContain('p_organization_id: c.organization_id')
    expect(source).toContain('p_transaction_id: c.transaction_id ?? null')
    expect(source).toContain('p_external_id: c.external_id ?? null')
    expect(source).toContain('SALE_NOT_FOUND_IN_ORGANIZATION')
    expect(source).not.toContain('db.from("sales")\n      .update(')
  })

  it('scopes checkout, conversations and agents by organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('db.from("checkout_sessions")')
    expect(source).toContain('db.from("crm_conversations")')
    expect(source).toContain('db.from("crm_agents")')
    expect(source).toContain('CONVERSATION_NOT_FOUND_IN_ORGANIZATION')
  })

  it('writes CRM messages and outbox rows with explicit organization context', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('db.from("crm_messages").insert({')
    expect(source).toContain('db.from("crm_channel_accounts")')
    expect(source).toContain('db.from("crm_channel_message_outbox").upsert({')
    expect(source).toContain('organization_id: c.organization_id')
  })

  it('namespaces stable keys and CRM idempotency by organization', async () => {
    const source = await readFile(enginePath, 'utf8')
    expect(source).toContain('${c.organization_id}:${String(explicit)}:${ruleId}')
    expect(source).toContain('automation:${c.organization_id}:${rule.id}:${identity}:${channel}:${hash}')
  })

  it('propagates organization_id from the event worker', async () => {
    const source = await readFile(eventWorkerPath, 'utf8')
    expect(source).toContain('id,user_id,organization_id,funnel_id,event_type')
    expect(source).toContain('organization_id: event.organization_id')
  })

  it('resolves the webhook organization and propagates it to events and automation', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toContain("db.from('webhook_integrations').select('organization_id')")
    expect(source).toContain('webhook_integration_organization_missing')
    expect(source).toContain('organization_id: organizationId')
    expect(source).toContain('/functions/v1/automation-engine-v2')
  })
})
