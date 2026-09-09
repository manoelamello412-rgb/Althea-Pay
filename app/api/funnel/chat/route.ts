import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/public-config'

const TARGET = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL}/functions/v1/funnel-events`
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-funnel-event-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const publicClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }) }

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token || token.length < 32 || token.length > 128) return NextResponse.json({ error: 'conversation_token_required' }, { status: 400, headers: cors })
  try {
    const { data, error } = await publicClient().rpc('crm_public_conversation', { p_token: token })
    if (error) return NextResponse.json({ error: 'conversation_unavailable' }, { status: 503, headers: cors })
    const result = data as { error?: string }
    if (result?.error === 'not_found') return NextResponse.json({ error: 'conversation_not_found' }, { status: 404, headers: cors })
    if (result?.error) return NextResponse.json(result, { status: 400, headers: cors })
    return NextResponse.json(data, { headers: { ...cors, 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'conversation_unavailable' }, { status: 503, headers: cors }) }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    if (body.length > 100_000) return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: cors })
    const parsed = JSON.parse(body) as Record<string, unknown>
    const token = typeof parsed.conversation_token === 'string' ? parsed.conversation_token.trim() : ''
    if (parsed.event_type === 'chat_message' && token) {
      const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
      if (!message || message.length > 4000) return NextResponse.json({ error: 'invalid_message' }, { status: 400, headers: cors })
      const { data, error } = await publicClient().rpc('crm_public_message', { p_token: token, p_body: message })
      if (error) return NextResponse.json({ error: 'message_unavailable' }, { status: 503, headers: cors })
      const result = data as { error?: string }
      if (result?.error) return NextResponse.json(result, { status: result.error === 'not_found' ? 404 : 400, headers: cors })
      return NextResponse.json(data, { status: 202, headers: cors })
    }
    const eventToken = req.headers.get('x-funnel-event-token')
    const response = await fetch(TARGET, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, ...(eventToken ? { 'x-funnel-event-token': eventToken } : {}) }, body, cache: 'no-store' })
    const responseBody = await response.text()
    return new NextResponse(responseBody, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json', ...cors } })
  } catch { return NextResponse.json({ error: 'chat_upstream_unavailable' }, { status: 502, headers: cors }) }
}
