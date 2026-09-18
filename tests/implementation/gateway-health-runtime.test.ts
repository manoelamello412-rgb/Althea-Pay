import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('gateway health runtime', () => {
  test('records health snapshots with the gateway tenant and protects the RPC', () => {
    const migration = source('supabase/migrations/20260918155645_fix_gateway_health_tenant_projection_v18.sql')
    expect(migration).toContain('where g.circuit_id = p_gateway_id')
    expect(migration).toContain('v_user_id')
    expect(migration).toContain('user_id,gateway_id,gateway_name')
    expect(migration).toContain('hs.user_id = v_user_id')
    expect(migration).toContain('alter column user_id set not null')
    expect(migration).toContain('grant select on public.gateway_health_snapshots to authenticated')
    expect(migration).toContain('gateway_health_snapshots_user_gateway_checked_idx')
    expect(migration).toContain('from public,anon,authenticated')
    expect(migration).toContain('to service_role')
  })

  test('connection test writes provider health on success, HTTP failure and runtime failure', () => {
    const edge = source('supabase/functions/gateway-connection-test/index.ts')
    expect(edge).toContain('credential_id,circuit_id')
    expect(edge).toContain('const recordHealth = async')
    expect(edge).toContain('db.rpc("record_gateway_health"')
    expect(edge).toContain('await recordHealth(false, latencyMs)')
    expect(edge).toContain('await recordHealth(true, latencyMs)')
  })

  test('gateway ranking consumes snapshots by both circuit and tenant identity', () => {
    const ranking = source('supabase/migrations/20260918034336_canonical_gateway_runtime_ranking.sql')
    expect(ranking).toContain('hs.gateway_id=g.circuit_id')
    expect(ranking).toContain('hs.user_id=p_user_id')
  })
})
