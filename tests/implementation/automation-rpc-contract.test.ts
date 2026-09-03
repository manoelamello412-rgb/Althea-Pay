import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path = 'supabase/functions/automation-engine-v2/index.ts'

describe('automation transaction RPC contract', () => {
  it('uses the canonical transaction state transition parameters', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('p_next_status: String(cfg.status)')
    expect(source).toContain('p_failure_code: cfg.error_message ? String(cfg.error_message) : null')
    expect(source).toContain('p_external_id: null')
    expect(source).not.toContain('p_new_status')
    expect(source).not.toContain('p_error_message')
    expect(source).not.toContain('p_external_status')
  })

  it('keeps the internal-secret guard on the automation endpoint', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('ALTHEA_INTERNAL_SECRET')
    expect(source).toContain('x-internal-secret')
  })
})
