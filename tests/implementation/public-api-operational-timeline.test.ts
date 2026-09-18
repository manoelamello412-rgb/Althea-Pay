import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public funnel operational API', () => {
  test('exposes the canonical funnel timeline through the existing public API surface', () => {
    const api = source('supabase/functions/althea-public-api/index.ts')
    expect(api).toContain('operational-timeline')
    expect(api).toContain('v_funnel_operational_timeline')
    expect(api).toContain('scopeOk(scopes,"funnels:read")')
    expect(api).toContain('.eq("user_id",key.user_id)')
    expect(api).toContain('.eq("funnel_id",itemId)')
    expect(api).toContain('category')
    expect(api).toContain('severity')
    expect(api).toContain('source')
    expect(api).toContain('before')
  })

  test('normalizes the hosted Edge Function route prefix', () => {
    const api = source('supabase/functions/althea-public-api/index.ts')
    expect(api).toContain('lastIndexOf("althea-public-api")')
    expect(api).toContain('pathSegments.slice(functionIndex+1)')
    expect(api).not.toContain('replace(/^\\/functions\\/v1\\/althea-public-api')
  })

  test('API key authentication uses the pgcrypto extension explicitly and remains service-only', () => {
    const migration = source('supabase/migrations/20260918154258_fix_public_api_key_auth_digest_v16.sql')
    expect(migration).toContain("extensions.digest(p_key,'sha256')")
    expect(migration).toContain('set search_path = pg_catalog, public')
    expect(migration).toContain('from public,anon,authenticated')
    expect(migration).toContain('to service_role')
  })

  test('security-invoker timeline has the minimal backend read ACLs required by the public API', () => {
    const migration = source('supabase/migrations/20260918154709_grant_operational_timeline_service_acl_v17.sql')
    expect(migration).toContain('grant select on public.checkout_events to service_role')
    expect(migration).toContain('grant select on public.gateway_checkout_telemetry to service_role')
    expect(migration).toContain('grant select on public.gateway_payment_attempts to service_role')
    expect(migration).toContain('grant select on public.transaction_audit_events to service_role')
    expect(migration).toContain('grant select on public.webhook_deliveries to service_role')
    expect(migration).toContain('grant select on public.outbound_webhook_deliveries to service_role')
    expect(migration).not.toContain('to anon')
  })
})
