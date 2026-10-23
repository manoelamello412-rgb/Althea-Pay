import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'

function fingerprint(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params
  const rawBody = await request.text()
  if (!rawBody) return NextResponse.json({ error: 'EMPTY_WEBHOOK_BODY' }, { status: 400 })

  const eventId = request.headers.get('x-event-id') ?? request.headers.get('x-webhook-id') ?? fingerprint(rawBody)
  const signature = request.headers.get('x-webhook-signature')

  try {
    const { url, publishableKey } = getSupabasePublicConfig()
    const supabase = createClient(url, publishableKey)
    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const eventType = typeof payload.type === 'string' ? payload.type : typeof payload.event === 'string' ? payload.event : 'unknown'

    const { data: connection } = await supabase
      .from('gateway_connections')
      .select('id, organization_id, status, provider')
      .eq('provider', provider.toLowerCase())
      .maybeSingle()

    if (!connection) return NextResponse.json({ error: 'PROVIDER_CONNECTION_NOT_FOUND' }, { status: 404 })

    const { error } = await supabase.from('integration_events').insert({
      organization_id: connection.organization_id,
      gateway_connection_id: connection.id,
      provider: provider.toLowerCase(),
      event_type: eventType,
      external_event_id: eventId,
      signature_valid: signature !== null,
      payload,
    })

    if (error?.code === '23505') return NextResponse.json({ accepted: true, duplicate: true }, { status: 200 })
    if (error) return NextResponse.json({ error: 'WEBHOOK_PERSIST_FAILED' }, { status: 500 })

    return NextResponse.json({ accepted: true, eventId }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'INVALID_WEBHOOK_PAYLOAD' }, { status: 400 })
  }
}
