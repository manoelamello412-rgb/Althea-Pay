import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('remote funnel chat bridge', () => {
  test('ingests remote chat into the canonical CRM idempotently', () => {
    const migration = source('supabase/migrations/20260918052534_crm_funnel_chat_remote_bridge_v10.sql')
    expect(migration).toContain('crm_ingest_funnel_chat_message')
    expect(migration).toContain("provider='funnel_chat'")
    expect(migration).toContain('external_message_id=v_external_message_id')
    expect(migration).toContain("delivery_mode','remote_api'")
    expect(migration).toContain('crm_conversations_remote_api_thread_uidx')
    expect(migration).toContain('to service_role')
    expect(migration).toContain('from public,anon,authenticated')
  })

  test('funnel events validates chat payload and mirrors it into CRM', () => {
    const worker = source('supabase/functions/funnel-events/index.ts')
    expect(worker).toContain('invalid_chat_message_payload')
    expect(worker).toContain('remote_conversation_id')
    expect(worker).toContain('crm_ingest_funnel_chat_message')
    expect(worker).toContain('crmConversationId')
  })

  test('remote adapter requires a provider-confirmed message id', () => {
    const adapter = source('supabase/functions/funnel-provider-adapter/index.ts')
    expect(adapter).toContain('"send_chat_message"')
    expect(adapter).toContain('chat_send_path')
    expect(adapter).toContain('chat_send_body')
    expect(adapter).toContain('chat_message_id_path')
    expect(adapter).toContain('remote_chat_message_id_missing')
    expect(adapter).toContain('external_message_id: externalMessageId')
  })

  test('dispatcher sends remote funnel chat through the adapter before marking sent', () => {
    const dispatcher = source('supabase/functions/crm-channel-outbox-dispatcher/index.ts')
    expect(dispatcher).toContain('async function sendFunnelChat')
    expect(dispatcher).toContain('deliveryMode !== "remote_api"')
    expect(dispatcher).toContain('operation: "send_chat_message"')
    expect(dispatcher).toContain('/functions/v1/funnel-provider-adapter')
    expect(dispatcher).toContain('payload.external_message_id')
    expect(dispatcher).toContain('status: "sent"')
    expect(dispatcher).toContain('verify_althea_internal_secret')
  })

  test('legacy local public chat remains distinct from remote API delivery', () => {
    const dispatcher = source('supabase/functions/crm-channel-outbox-dispatcher/index.ts')
    expect(dispatcher).toContain('conversation.public_token')
    expect(dispatcher).toContain('"funnel_chat_local"')
    expect(dispatcher).toContain('"funnel_chat_remote"')
  })

  test('funnel connector exposes configurable remote chat delivery', () => {
    const control = source('supabase/functions/funnel-connection-control/index.ts')
    const ui = source('components/funnel-remote-control.tsx')
    expect(control).toContain('chat_enabled')
    expect(control).toContain('chat:write')
    expect(control).toContain('chat_send_path')
    expect(ui).toContain('Permitir respostas pelo chat')
    expect(ui).toContain('chat_send_path: chatSendPath.trim()')
    expect(ui).toContain('chat_message_id_path: chatMessageIdPath.trim()')
  })

  test('dispatcher service ACLs are explicit and do not open the outbox to anon', () => {
    const migration = source('supabase/migrations/20260918052534_crm_funnel_chat_remote_bridge_v10.sql')
    expect(migration).toContain('grant select,update on public.crm_channel_message_outbox to service_role')
    expect(migration).toContain('grant select,insert,update on public.crm_messages to service_role')
    expect(migration).not.toContain('crm_channel_message_outbox to anon')
  })
})
