import { NextResponse } from 'next/server'
import { headers } from 'next/headers'

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

export async function GET() {
  const requestHeaders = await headers()
  const forwardedFor = firstForwardedValue(requestHeaders.get('x-forwarded-for'))
  const realIp = requestHeaders.get('x-real-ip')?.trim() || ''
  const ip = forwardedFor || realIp || ''

  return NextResponse.json({
    ip: ip || null,
    isp: null,
    location: [
      requestHeaders.get('x-vercel-ip-city'),
      requestHeaders.get('x-vercel-ip-region'),
      requestHeaders.get('x-vercel-ip-country'),
    ].filter(Boolean).join(', ') || null,
    country: requestHeaders.get('x-vercel-ip-country') || null,
    region: requestHeaders.get('x-vercel-ip-region') || null,
    city: requestHeaders.get('x-vercel-ip-city') || null,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
