import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/x/[op]/route'

describe('funnel snippet proxy', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('forwards origin and client IP, and returns only the body without backend headers', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk')
    const fetchMock = vi.fn(async () => new Response('{"token":"t"}', { status: 200, headers: { 'sb-project-ref': 'ref', 'x-served-by': 'supabase-edge-runtime', server: 'cloudflare' } }))
    vi.stubGlobal('fetch', fetchMock)
    const request = new NextRequest('https://app.example/api/x/t', {
      method: 'POST',
      body: '{"funnel_id":"f1"}',
      headers: { 'content-type': 'application/json', origin: 'https://funil.example', 'x-forwarded-for': '1.2.3.4, 10.0.0.1', cookie: 'sb=secret' },
    })
    const response = await POST(request, { params: Promise.resolve({ op: 't' }) })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = init.headers as Headers
    expect(url).toBe('https://ref.supabase.co/functions/v1/funnel-client-token')
    expect(sent.get('origin')).toBe('https://funil.example')
    expect(sent.get('x-forwarded-for')).toBe('1.2.3.4')
    expect(sent.get('cookie')).toBeNull()
    expect(await response.json()).toEqual({ token: 't' })
    for (const h of ['sb-project-ref', 'x-served-by', 'server']) expect(response.headers.get(h)).toBeNull()
  })

  it('rejects unknown targets', async () => {
    const response = await POST(new NextRequest('https://app.example/api/x/z', { method: 'POST' }), { params: Promise.resolve({ op: 'z' }) })
    expect(response.status).toBe(404)
  })
})
