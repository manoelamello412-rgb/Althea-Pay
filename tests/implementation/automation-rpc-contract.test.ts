import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path = 'supabase/functions/automation-engine-v2/index.ts'

describe('automation transaction RPC contract', () => {
  it('uses the canonical transaction state transition parameters', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('p_next_status: String(cfg.status)')
    expect(source).toContain('p_failure_code: cfg.error_message ? String(cfg.error_message) : null')
    expect(source).toContain('p_external_id: null')
    expect(source).toContain('p_expected_version: Number(current.version)')
    expect(source).not.toContain('p_new_status')
    expect(source).not.toContain('p_external_status')
  })

  it('prevalidates and postvalidates the transaction organization boundary', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('db.from("gateway_transactions")')
    expect(source).toContain('.eq("id", c.transaction_id)')
    expect(source).toContain('.eq("organization_id", c.organization_id)')
    expect(source).toContain('.eq("user_id", c.user_id)')
    expect(source).toContain('TRANSACTION_NOT_FOUND_IN_ORGANIZATION')
    expect(source).toContain('TRANSACTION_TENANT_MISMATCH')
  })

  it('keeps the internal-secret guard on the automation endpoint', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('ALTHEA_INTERNAL_SECRET')
    expect(source).toContain('x-internal-secret')
  })

  it('supports ordered multi-action plans with explicit failure policy', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('Array.isArray(root.actions)')
    expect(source).toContain('const stopOnError = root.stop_on_error !== false')
    expect(source).toContain('type: "multi_action"')
  })
})
