import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const funnelEventsPath = 'supabase/functions/funnel-events/index.ts'
const webhookPath = 'supabase/functions/althea-webhook/index.ts'

describe('writer identity organization boundary', () => {
  it('namespaces funnel event_key by organization, funnel and raw external id', async () => {
    const source = await readFile(funnelEventsPath, 'utf8')
    expect(source).toContain('org:${String(funnel.organization_id)}:funnel:${funnelId}:event:${externalId}')
    expect(source).toContain('p_event_key:eventKey')
    expect(source).not.toContain('.eq("user_id",uid).eq("external_id",externalId).maybeSingle()')
  })

  it('persists funnel events through the guarded server RPC and deduplicates by event_key', async () => {
    const source = await readFile(funnelEventsPath, 'utf8')
    expect(source).toContain('db.rpc("server_insert_integration_event_v1"')
    expect(source).toContain('p_organization_id:funnel.organization_id')
    expect(source).toContain('.eq("event_key",eventKey).maybeSingle()')
    expect(source).toContain('insertedEvent.error.code==="23505"&&eventKey')
    expect(source).toContain('duplicate:true,event_id:duplicate.id,status:duplicate.status')
    expect(source).not.toContain('db.from("integration_events").insert(')
  })

  it('allows the same raw event id to map to different keys across organizations and funnels', () => {
    const key = (org: string, funnel: string, external: string) =>
      `org:${org}:funnel:${funnel}:event:${external}`

    expect(key('org-a', 'funnel-a', 'evt-123')).not.toBe(key('org-b', 'funnel-a', 'evt-123'))
    expect(key('org-a', 'funnel-a', 'evt-123')).not.toBe(key('org-a', 'funnel-b', 'evt-123'))
    expect(key('org-a', 'funnel-a', 'evt-123')).toBe(key('org-a', 'funnel-a', 'evt-123'))
  })

  it('writes webhook events and sales only through guarded server RPCs', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toContain("db.rpc('server_insert_integration_event_v1'")
    expect(source).toContain("db.rpc('server_upsert_transaction_sale_v1'")
    expect(source).toContain("db.rpc('server_update_sale_status_v1'")
    expect(source).toContain('p_organization_id: organizationId')
    expect(source).toContain('p_transaction_id: transaction.id')
    expect(source).not.toContain("db.from('sales').insert(")
    expect(source).not.toContain("db.from('sales').update(")
    expect(source).not.toContain("db.from('integration_events').insert(")
  })

  it('keeps webhook transaction and checkout lookups tenant-scoped', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toContain(".eq('organization_id', organizationId).eq('funnel_id', funnelId)")
    expect(source).toContain('p_external_id: saleExternalId')
    expect(source).not.toContain('id: `sale_${eventId}`')
  })
})
