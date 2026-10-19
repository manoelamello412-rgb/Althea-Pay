import { NextRequest } from 'next/server'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same-origin proxy for the funnel page snippet: the browser never sees the backend host or its headers.
const TARGETS: Record<string, string> = { t: 'funnel-client-token', e: 'funnel-events' }
const FORWARD = ['content-type', 'origin', 'x-funnel-client-token', 'x-funnel-event-token']
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-funnel-client-token, x-funnel-event-token',
  'access-control-max-age': '600',
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ op: string }> }) {
  const target = TARGETS[(await ctx.params).op]
  if (!target) return new Response(null, { status: 404, headers: CORS })

  const headers = new Headers()
  for (const name of FORWARD) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Vercel sets x-forwarded-for to the real client IP; the token function rate-limits on its first entry.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
  if (ip) headers.set('x-forwarded-for', ip)

  try {
    const upstream = await fetch(`${getSupabasePublicConfig().url}/functions/v1/${target}`, {
      method: 'POST',
      headers,
      body: await request.text(),
      cache: 'no-store',
    })
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 502, headers: CORS })
  }
}
