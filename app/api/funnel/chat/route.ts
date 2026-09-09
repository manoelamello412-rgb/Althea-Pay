import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/public-config'

const TARGET = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL}/functions/v1/funnel-events`
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-funnel-event-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token || token.length < 32 || token.length > 128) return NextResponse.json({ error: 'conversation_token_required' }, { status: 400, headers: cors })
  try {
    const db = createSupabaseAdminClient()
    const conversation = await db.from('crm_conversations').select('id,funnel_id,product_id,buyer_name,buyer_email,status,updated_at').eq('public_token', token).maybeSingle()
    if (conversation.error) throw conversation.error
    if (!conversation.data) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404, headers: cors })
    const messages = await db.from('crm_messages').select('id,direction,channel,body,created_at').eq('conversation_id', conversation.data.id).order('created_at', { ascending: true }).limit(200)
    if (messages.error) throw messages.error
    return NextResponse.json({ conversation: conversation.data, messages: messages.data ?? [] }, { headers: { ...cors, 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'conversation_unavailable' }, { status: 503, headers: cors })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    if (body.length > 100_000) return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: cors })
    const token = req.headers.get('x-funnel-event-token')
    const response = await fetch(TARGET, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, ...(token ? { 'x-funnel-event-token': token } : {}) }, body, cache: 'no-store' })
    const text = await response.text()
    return new NextResponse(text, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json', ...cors } })
  } catch {
    return NextResponse.json({ error: 'chat_upstream_unavailable' }, { status: 502, headers: cors })
  }
}
