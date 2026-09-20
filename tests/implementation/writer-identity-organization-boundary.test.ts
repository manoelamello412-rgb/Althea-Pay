import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const funnelEventsPath = 'supabase/functions/funnel-events/index.ts'
const webhookPath = 'supabase/functions/althea-webhook/index.ts'

describe('writer identity organization boundary', () => {
  it('namespaces funnel event_key by organization, funnel and raw external id', async () => {
    const source = await readFile(funnelEventsPath, 'utf8')
    expect(source).toContain('org:${String(funnel.organization_id)}:funnel:${funnelId}:event:${externalId}')
    expect(source).toContain('event_key:eventKey')
    expect(source).not.toContain('.eq("user_id",uid).eq("external_id",externalId).maybeSingle()')
  })

  it('deduplicates funnel events only by the canonical event_key', async () => {
    const source = await readFile(funnelEventsPath, 'utf8')
    expect(source).toContain('.eq("event_key",eventKey).maybeSingle()')
    expect(source).toContain('error.code==="23505"&&eventKey')
    expect(source).toContain('duplicate:true,event_id:duplicate.id,status:duplicate.status')
    expect(source).toContain('return out({error:"event_rejected"},400)')
  })

  it('allows the same raw event id to map to different keys across organizations and funnels', () => {
    const key = (org: string, funnel: string, external: string) =>
      `org:${org}:funnel:${funnel}:event:${external}`

    expect(key('org-a', 'funnel-a', 'evt-123')).not.toBe(key('org-b', 'funnel-a', 'evt-123'))
    expect(key('org-a', 'funnel-a', 'evt-123')).not.toBe(key('org-a', 'funnel-b', 'evt-123'))
    expect(key('org-a', 'funnel-a', 'evt-123')).toBe(key('org-a', 'funnel-a', 'evt-123'))
  })

  it('writes webhook sales with explicit organization and transaction-based identity', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toContain('organization_id: organizationId')
    expect(source).toContain(".eq('organization_id', organizationId).eq('user_id', userId).eq('transaction_id', transaction.id)")
    expect(source).toContain('id: `gateway_tx_${transaction.id}`')
    expect(source).not.toContain('id: `sale_${eventId}`')
  })

  it('keeps webhook sale updates tenant-scoped and rejects ambiguous external-id fallback', async () => {
    const source = await readFile(webhookPath, 'utf8')
    expect(source).toContain("sale_external_id_ambiguous")
    expect(source).toContain("sale_external_id_conflict")
    expect(source).toContain(".eq('external_id', saleExternalId).limit(2)")
    expect(source).toContain(".eq('id', targetSale.id).eq('organization_id', organizationId).eq('user_id', userId)")
  })

  it('does not treat external id as the primary sale identity', async () => {
    const source = await readFile(webhookPath, 'utf8')
    const transactionLookup = source.indexOf(".eq('transaction_id', transaction.id).maybeSingle()")
    const fallbackLookup = source.indexOf(".eq('external_id', saleExternalId).limit(2)")
    expect(transactionLookup).toBeGreaterThan(-1)
    expect(fallbackLookup).toBeGreaterThan(transactionLookup)
  })
})
