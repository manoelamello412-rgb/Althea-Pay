// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const snippet = readFileSync('public/althea.js', 'utf8')
const API = 'https://project.supabase.co'

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function boot(search = '') {
  window.history.replaceState(null, '', '/quiz' + search)
  const script = document.createElement('script')
  script.setAttribute('data-funnel-id', 'funnel-1')
  script.setAttribute('data-api', API + '/')
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    const body = url.endsWith('/funnel-client-token') ? { token: 'alt_fct_abc.sig', expires_in: 600 } : { accepted: true }
    return new Response(JSON.stringify(body), { status: 200 })
  }))
  new Function(snippet)()
  return calls
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const althea = () => (window as unknown as { althea: { track: (t: string, d?: object) => Promise<unknown>; identify: (d: object) => void; visitorId: string } }).althea

describe('althea.js page snippet', () => {
  beforeEach(() => {
    delete (window as unknown as { althea?: unknown }).althea
    localStorage.clear()
    sessionStorage.clear()
  })

  it('sends page_view on load with only the funnel id as credential', async () => {
    const calls = boot('?utm_source=meta&utm_campaign=black&fbclid=fb1')
    await flush(); await flush()
    expect(calls.map(c => c.url)).toEqual([`${API}/functions/v1/funnel-client-token`, `${API}/functions/v1/funnel-events`])
    expect(calls[0].body).toEqual({ funnel_id: 'funnel-1' })
    expect(calls[0].headers).not.toHaveProperty('x-funnel-event-token')
    expect(calls[1].headers['x-funnel-client-token']).toBe('alt_fct_abc.sig')
    expect(calls[1].body).toMatchObject({ event_type: 'page_view', funnel_id: 'funnel-1', source: 'meta', campaign: 'black', click_id: 'fb1', visitor_id: althea().visitorId })
    expect(calls[1].body.event_id).toBeTruthy()
    expect(calls[1].body.session_id).toBeTruthy()
  })

  it('reuses the token, keeps visitor/session/UTMs and attaches identified customer', async () => {
    const calls = boot('?utm_source=google')
    await flush(); await flush()
    althea().identify({ email: 'a@b.com' })
    await althea().track('checkout_started', { product_id: 'p1' })
    const [, pageView, checkout] = calls
    expect(calls.filter(c => c.url.endsWith('/funnel-client-token'))).toHaveLength(1)
    expect(checkout.body).toMatchObject({ event_type: 'checkout_started', product_id: 'p1', source: 'google', customer: { email: 'a@b.com' } })
    expect(checkout.body.visitor_id).toBe(pageView.body.visitor_id)
    expect(checkout.body.session_id).toBe(pageView.body.session_id)
    expect(checkout.body.event_id).not.toBe(pageView.body.event_id)
  })

  it('keeps landing UTMs and the visitor on the next page of the session', async () => {
    const first = boot('?utm_source=tiktok')
    await flush(); await flush()
    delete (window as unknown as { althea?: unknown }).althea
    const second = boot('')
    await flush(); await flush()
    expect(second[1].body).toMatchObject({ source: 'tiktok', visitor_id: first[1].body.visitor_id, session_id: first[1].body.session_id })
  })

  it('does nothing without funnel id or api', () => {
    Object.defineProperty(document, 'currentScript', { value: document.createElement('script'), configurable: true })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    new Function(snippet)()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((window as unknown as { althea?: unknown }).althea).toBeUndefined()
  })
})

describe('origin-bound client token contract', () => {
  const migration = readFileSync('supabase/migrations/20261013160000_funnel_public_origin_v1.sql', 'utf8')
  const fn = readFileSync('supabase/functions/funnel-client-token/index.ts', 'utf8')

  it('keeps the origin resolver server-only', () => {
    expect(migration).toMatch(/revoke all on function public\.resolve_funnel_public_origin\(text, text\) from public, anon, authenticated/)
    expect(migration).toContain('to service_role')
  })

  it('rate limits and checks Origin before issuing a token without the ingestion secret', () => {
    const originPath = fn.slice(fn.indexOf('}else{'), fn.indexOf('const requestedTtl'))
    expect(originPath).toContain('req.headers.get("origin")')
    expect(originPath).toContain('consume_funnel_event_rate_limit')
    expect(originPath).toContain('resolve_funnel_public_origin')
    expect(originPath).toContain('"origin_not_allowed"},403')
  })
})
