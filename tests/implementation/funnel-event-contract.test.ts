import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('canonical funnel event contract', () => {
  it('stores canonical event metadata and stable correlation identifiers', async () => {
    const source = await readFile('supabase/functions/funnel-events/index.ts', 'utf8')
    expect(source).toContain('canonicalEventType')
    expect(source).toContain('body.event_id??body.external_id')
    expect(source).toContain('original_event_type:originalType')
    expect(source).toContain('protocol_version:protocolVersion')
    expect(source).toContain('session_id:sessionId')
    expect(source).toContain('visitor_id:visitorId')
  })

  it('keeps telemetry thin and blocks raw card secrets', async () => {
    const source = await readFile('app/api/funnel/telemetry/route.ts', 'utf8')
    expect(source).not.toContain('ALLOWED_EVENTS')
    expect(source).toContain('containsForbiddenPaymentData')
    expect(source).toContain("'pan'")
    expect(source).toContain("'cvv'")
    expect(source).toContain("'visitor_id'")
  })

  it('routes public API event writes through the canonical ingestion function', async () => {
    const source = await readFile('supabase/functions/althea-public-api/index.ts', 'utf8')
    expect(source).toContain('/functions/v1/funnel-events')
    expect(source).toContain('event_pipeline_unavailable')
    expect(source).not.toContain('eventKey=')
  })

  it('preserves legacy aliases in the event registry while defining v1 canonical names', async () => {
    const source = await readFile('supabase/migrations/20260918165723_canonical_funnel_event_contract_v21.sql', 'utf8')
    expect(source).toContain("when 'page_view' then 'page_viewed'")
    expect(source).toContain("when 'purchase' then 'payment_approved'")
    expect(source).toContain("('pix_created','PIX criado',true,'pix_created','1',false)")
    expect(source).toContain("('conversation_closed','Conversa encerrada',true,'conversation_closed','1',false)")
  })
})
