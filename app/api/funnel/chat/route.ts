import { NextRequest, NextResponse } from 'next/server'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/public-config'

const TARGET = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL}/functions/v1/funnel-events`
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-funnel-event-token', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    if (body.length > 100_000) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
    const token = req.headers.get('x-funnel-event-token')
    const response = await fetch(TARGET, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, ...(token ? { 'x-funnel-event-token': token } : {}) }, body, cache: 'no-store' })
    const text = await response.text()
    return new NextResponse(text, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin': '*' } })
  } catch {
    return NextResponse.json({ error: 'chat_upstream_unavailable' }, { status: 502 })
  }
}
