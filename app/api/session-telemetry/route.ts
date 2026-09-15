import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  const requestHeaders = await headers()
  const region = requestHeaders.get('x-vercel-ip-region')?.trim() || null
  const city = requestHeaders.get('x-vercel-ip-city')?.trim() || null
  const country = requestHeaders.get('x-vercel-ip-country')?.trim() || null

  // Never expose the raw client IP or forwarded IP through this endpoint.
  // The route is authenticated because telemetry is an internal session concern.
  void firstForwardedValue

  return NextResponse.json({
    location: [city, region, country].filter(Boolean).join(', ') || null,
    country,
    region,
    city,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
