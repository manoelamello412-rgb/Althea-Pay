import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public checkout/chat security boundary', () => {
  it('keeps privileged public checkout RPCs out of the browser bundle', () => {
    const page = readFileSync('app/checkout/[funnelId]/page.tsx', 'utf8')

    expect(page).toContain('/api/checkout/public')
    expect(page).not.toContain("rpc('get_public_checkout_context'")
    expect(page).not.toContain("rpc('create_public_checkout_session'")
    expect(page).not.toContain('createSupabaseBrowserClient')
  })

  it('routes checkout and chat RPC calls through the server admin client', () => {
    const checkout = readFileSync('app/api/checkout/public/route.ts', 'utf8')
    const chat = readFileSync('app/api/funnel/chat/route.ts', 'utf8')

    expect(checkout).toContain('createSupabaseAdminClient')
    expect(checkout).toContain("admin.rpc('get_public_checkout_context'")
    expect(checkout).toContain("admin.rpc('create_public_checkout_session'")
    expect(checkout).toContain('consumePublicRateLimit')

    expect(chat).toContain('createSupabaseAdminClient')
    expect(chat).toContain("admin.rpc('crm_public_conversation'")
    expect(chat).toContain("admin.rpc('crm_public_message'")
    expect(chat).toContain('consumePublicRateLimit')
    expect(chat).not.toContain('getPublicClient')
  })

  it('rate limits public payment creation and status polling', () => {
    const create = readFileSync('app/api/payments/create/route.ts', 'utf8')
    const action = readFileSync('app/api/payments/action/route.ts', 'utf8')

    expect(create).toContain("consumePublicRateLimit(admin, request, 'payment-create'")
    expect(action).toContain("consumePublicRateLimit(admin, request, 'payment-action'")
  })

  it('pre-grants only the trusted server role during rollout phase A', () => {
    const migration = readFileSync(
      'supabase/migrations/20260919201500_grant_public_surface_server_executor.sql',
      'utf8',
    )

    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/revoke\s+execute[^;]+from\s+(anon|authenticated)/i)
  })
})
