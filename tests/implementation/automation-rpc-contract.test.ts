import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path = 'supabase/functions/automation-engine-v2/index.ts'

describe('automation transaction RPC contract', () => {
  it('uses the canonical transaction state transition parameters', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toMatch(/p_next_status\\s*:\\s*String\\(cfg\\.status\\)/)
    expect(source).toMatch(/p_failure_code\\s*:\\s*cfg\\.error_message\\s*\\?\\s*String\\(cfg\\.error_message\\)\\s*:\\s*null/)
    expect(source).toMatch(/p_external_id\\s*:\\s*null/)
    expect(source).toMatch(/p_expected_version\\s*:\\s*Number\\(current\\.version\\)/)
    expect(source).not.toContain('p_new_status')
    expect(source).not.toContain('p_error_message')
    expect(source).not.toContain('p_external_status')
  })

  it('prevalidates and postvalidates the transaction organization boundary', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toMatch(/from\\("gateway_transactions"\\)[\\s\\S]*?eq\\("id",\\s*c\\.transaction_id\\)[\\s\\S]*?eq\\("organization_id",\\s*c\\.organization_id\\)[\\s\\S]*?eq\\("user_id",\\s*c\\.user_id\\)/)
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
    expect(source).toMatch(/(?:const\\s+)?stopOnError\\s*=\\s*root\\.stop_on_error\\s*!==\\s*false/)
    expect(source).toMatch(/type\\s*:\\s*["']multi_action["']/)
  })
})
