import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

describe('internal service authentication', () => {
  it('keeps Vault/RPC as the single ALTHEA_INTERNAL_SECRET authority in Edge Functions', () => {
    const files = walk('supabase/functions').filter((path) => path.endsWith('.ts'))
    const offenders = files.filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /Deno\.env\.get\((["'])ALTHEA_INTERNAL_SECRET\1\)/.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('keeps the runtime service-role grants migration versioned', () => {
    const source = readFileSync(
      'supabase/migrations/20260918161800_worker_runtime_service_role_acl_v20.sql',
      'utf8',
    )

    for (const table of [
      'gateway_webhook_events',
      'automation_executions',
      'crm_agents',
      'iara_commercial_interventions',
      'crm_channel_message_outbox',
      'iara_daily_reports',
    ]) {
      expect(source).toContain(`public.${table}`)
    }
  })
})
