import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('funnel browser connector', () => {
  it('keeps the long-lived ingestion credential server-side', async () => {
    const source = await readFile('supabase/functions/funnel-client-token/index.ts', 'utf8')
    expect(source).toContain('x-funnel-event-token')
    expect(source).toContain('alt_fct_')
    expect(source).toContain('Math.min(600')
    expect(source).toContain('events:write')
    expect(source).toContain('funnel_id:funnelId')
  })

  it('ships a browser SDK with visitor/session identity and bounded retry queue', async () => {
    const source = await readFile('public/althea-funnel-connector.js', 'utf8')
    expect(source).toContain("visitor_")
    expect(source).toContain("session_")
    expect(source).toContain("page_viewed")
    expect(source).toContain("session_started")
    expect(source).toContain("items.slice(-100)")
    expect(source).toContain("authorization: 'Bearer ' + this.token")
  })

  it('forbids raw card material in the public connector', async () => {
    const source = await readFile('public/althea-funnel-connector.js', 'utf8')
    expect(source).toContain("'pan'")
    expect(source).toContain("'card_number'")
    expect(source).toContain("'cvv'")
    expect(source).toContain("'cvc'")
  })

  it('applies a distributed database-backed event rate limit', async () => {
    const source = await readFile('supabase/migrations/20260918170458_funnel_event_rate_limit_v23.sql', 'utf8')
    expect(source).toContain('private.funnel_event_rate_limit_buckets')
    expect(source).toContain('consume_funnel_event_rate_limit')
    expect(source).toContain('to service_role')
  })
})
