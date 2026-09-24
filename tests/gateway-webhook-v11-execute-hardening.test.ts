import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260924003000_gateway_webhook_v11_execute_hardening_v1.sql',
  'utf8',
)
const normalizedMigration = migration.replace(/\s+/g, ' ').toLowerCase()
const g1a = readFileSync(
  'supabase/migrations/20260921040000_gateway_webhook_processing_contract_v1.sql',
  'utf8',
)
const normalizedG1a = g1a.replace(/\s+/g, ' ').toLowerCase()

function listTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

describe('G1-C gateway webhook v11 execute hardening', () => {
  it('revokes direct service_role EXECUTE only from the exact v11 signature', () => {
    expect(normalizedMigration).toContain(
      'revoke execute on function public.process_gateway_webhook_v11( uuid, text, text, text, text, numeric, text, text ) from service_role;',
    )
    expect(migration).toContain(
      "has_function_privilege('service_role',v_v11,'EXECUTE')",
    )
    expect(migration).toContain(
      'g1c_post_guard: service_role direct v11 execute remains',
    )
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.process_gateway_webhook_v11[\s\S]*to\s+service_role/i,
    )
  })

  it('keeps the fenced wrapper executable by service_role', () => {
    expect(migration).toContain(
      "'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)'",
    )
    expect(migration).toContain(
      "if not has_function_privilege('service_role',v_wrapper,'EXECUTE') then",
    )
    expect(migration).toContain(
      'g1c_post_guard: wrapper service_role execute missing',
    )
  })

  it('preserves the wrapper delegation to v11 without redefining either function', () => {
    expect(normalizedG1a).toContain(
      'select public.process_gateway_webhook_v11( p_webhook_id, p_next_status, v_external, p_failure_code, p_event_kind, p_amount, p_currency, p_external_event_id ) into v_result',
    )
    expect(migration).toContain(
      "position('select public.process_gateway_webhook_v11(' in v_wrapper_definition)",
    )
    expect(migration).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.(?:process_gateway_webhook_v11|server_process_claimed_gateway_webhook_v1)/i,
    )
  })

  it('keeps v11 present and protects PUBLIC, anon and authenticated execute boundaries', () => {
    expect(migration).toContain(
      "'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)'",
    )
    expect(migration).toContain(
      "has_function_privilege('anon',v_v11,'EXECUTE')",
    )
    expect(migration).toContain(
      "has_function_privilege('authenticated',v_v11,'EXECUTE')",
    )
    expect(migration).toContain("a.grantee=0")
    expect(migration).not.toMatch(/drop\s+function\s+.*process_gateway_webhook_v11/i)
  })

  it('keeps zero direct v11 callers in Edge Functions', () => {
    const directV11Callers = listTsFiles('supabase/functions')
      .filter((path) =>
        readFileSync(path, 'utf8').includes('process_gateway_webhook_v11'),
      )
      .map((path) => relative('.', path).replaceAll('\\', '/'))
      .sort()

    expect(directV11Callers).toEqual([])
  })

  it('keeps zero direct gateway_webhook_events table access in Edge Functions', () => {
    const directQueueTableAccess = listTsFiles('supabase/functions')
      .filter((path) =>
        /\.from\(\s*["']gateway_webhook_events["']\s*\)/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative('.', path).replaceAll('\\', '/'))
      .sort()

    expect(directQueueTableAccess).toEqual([])
  })

  it('does not broaden the hardening beyond the v11 execute boundary', () => {
    expect(migration).not.toMatch(/alter\s+table/i)
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i)
    expect(migration).not.toMatch(/drop\s+function/i)
    expect(migration).not.toMatch(/grant\s+execute/i)
    expect(migration).not.toContain('gateway_webhook_events')
  })
})
