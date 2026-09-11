import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path = 'supabase/functions/automation-engine-v2/index.ts'

describe('automation transaction RPC contract', () => {
  it('uses the canonical transaction state transition parameters', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toMatch(/p_next_status\s*:\s*String\(cfg\.status\)/)
    expect(source).toMatch(/p_failure_code\s*:\s*cfg\.error_message\s*\?\s*String\(cfg\.error_message\)\s*:\s*null/)
    expect(source).toMatch(/p_external_id\s*:\s*null/)
    expect(source).not.toContain('p_new_status')
    expect(source).not.toContain('p_error_message')
    expect(source).not.toContain('p_external_status')
  })

  it('keeps the internal-secret guard on the automation endpoint', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('ALTHEA_INTERNAL_SECRET')
    expect(source).toContain('x-internal-secret')
  })

  it('supports ordered multi-action plans with explicit failure policy', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('Array.isArray(root.actions)')
    expect(source).toMatch(/(?:const\s+)?stopOnError\s*=\s*root\.stop_on_error\s*!==\s*false/)
    expect(source).toMatch(/type\s*:\s*["']multi_action["']/)
  })
})
