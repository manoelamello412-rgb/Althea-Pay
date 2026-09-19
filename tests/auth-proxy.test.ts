import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const auth = vi.hoisted(() => ({ authenticated: false }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({
  auth: { getClaims: async () => ({ data: auth.authenticated ? { claims: { sub:'user' } } : null, error:null }) },
}) }))
beforeEach(() => {
  auth.authenticated=false
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','public-test-key')
})
describe('auth proxy regression', () => {
  it.each(['/forgot-password','/reset-password?code=code&next=%2Fdashboard%2Fprodutos','/checkout/funnel'])('allows an unauthenticated visitor to %s', async path => {
    const response=await proxy(new NextRequest(`https://pay.example${path}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
  it('protects dashboard and preserves the original query in next', async () => {
    const response=await proxy(new NextRequest('https://pay.example/dashboard/crm?conversation=abc&filter=open'))
    const target=new URL(response.headers.get('location')!)
    expect(target.pathname).toBe('/login')
    expect(target.searchParams.get('next')).toBe('/dashboard/crm?conversation=abc&filter=open')
    expect(target.searchParams.has('conversation')).toBe(false)
  })
  it('uses only a safe local next for authenticated login redirects', async () => {
    auth.authenticated=true
    for(const [next,expected] of [['/dashboard/produtos','/dashboard/produtos'],['//evil.test','/dashboard']]) {
      const response=await proxy(new NextRequest(`https://pay.example/login?${new URLSearchParams({next})}`))
      expect(response.headers.get('location')).toBe(`https://pay.example${expected}`)
    }
  })
})
