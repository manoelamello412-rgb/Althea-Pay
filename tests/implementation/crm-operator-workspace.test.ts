import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('CRM operator workspace', () => {
  it('keeps workspace reads and mutations behind authenticated user ownership', async () => {
    const source = await readFile('supabase/migrations/20260918173012_crm_operator_workspace_v25.sql', 'utf8')

    expect(source).toContain('crm_operator_workspace_v1')
    expect(source).toContain('crm_operator_add_note_v1')
    expect(source).toContain('crm_operator_set_tag_v1')
    expect(source).toContain('crm_operator_create_task_v1')
    expect(source).toContain('where id=p_conversation_id and user_id=v_uid')
    expect(source).toContain('from public,anon')
    expect(source).toContain('to authenticated')
  })

  it('reuses canonical CRM tables for notes, tags, tasks, identities, SLA and delivery', async () => {
    const source = await readFile('supabase/migrations/20260918173012_crm_operator_workspace_v25.sql', 'utf8')

    expect(source).toContain('crm_conversation_notes')
    expect(source).toContain('crm_conversation_tags')
    expect(source).toContain('crm_tasks')
    expect(source).toContain('crm_channel_identities')
    expect(source).toContain('crm_channel_delivery_events')
    expect(source).toContain('crm_channel_message_outbox')
    expect(source).toContain('crm_conversation_sla')
  })

  it('exposes premium operator controls without creating a second CRM page', async () => {
    const workspace = await readFile('components/crm-operator-workspace.tsx', 'utf8')
    const crm = await readFile('app/dashboard/crm/page.tsx', 'utf8')

    expect(workspace).toContain("rpc('crm_operator_workspace_v1'")
    expect(workspace).toContain("rpc('crm_operator_add_note_v1'")
    expect(workspace).toContain("rpc('crm_operator_set_tag_v1'")
    expect(workspace).toContain("rpc('crm_operator_create_task_v1'")
    expect(workspace).toContain("rpc('crm_complete_task'")
    expect(workspace).toContain('Respostas rápidas')
    expect(workspace).toContain('Notas internas')
    expect(workspace).toContain('Identidades e canais')
    expect(workspace).toContain('Entrega de mensagens')

    expect(crm).toContain("import { CRMOperatorWorkspace } from '@/components/crm-operator-workspace'")
    expect(crm).toContain('<CRMOperatorWorkspace conversationId={selected.id}')
  })

  it('does not expose provider event payloads through the operator workspace RPC', async () => {
    const source = await readFile('supabase/migrations/20260918173012_crm_operator_workspace_v25.sql', 'utf8')

    expect(source).toContain("'external_message_id',d.external_message_id")
    expect(source).toContain("'status',d.status")
    expect(source).not.toContain("'provider_event',d.provider_event")
  })
})
