import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const processorPath = 'lib/crm/ai-inference-processor.ts'
const providerPath = 'lib/crm/ai/provider.ts'
const executionPath = 'app/api/crm/ai-agent/execute/route.ts'
const kernelPath = 'services/iara-agent/execution-kernel.ts'
const migrationPath = 'supabase/migrations/20260910009000_crm_ai_action_channel_aware_execution_v3.sql'

describe('AI Revenue Agent inference contracts', () => {
  it('uses the canonical action vocabulary and strict unknown validation', async () => {
    const source = await readFile(processorPath, 'utf8')
    expect(source).toContain("'payment_follow_up'")
    expect(source).toContain("'sales_follow_up'")
    expect(source).toContain("'recovery_follow_up'")
    expect(source).toContain("'qualification'")
    expect(source).toContain("'upsell_or_post_sale'")
    expect(source).toContain('typeof score !== \'number\'')
    expect(source).toContain('JSON.parse(message.content)')
    expect(source).not.toContain('as any')
  })

  it('handles provider retry signals without changing the canonical ledger', async () => {
    const source = await readFile(processorPath, 'utf8')
    const provider = await readFile(providerPath, 'utf8')
    expect(source).toContain("response.headers.get('Retry-After')")
    expect(source).toContain('429')
    expect(source).toContain('503')
    expect(source).toContain('AbortController')
    expect(source).toContain('AI_INFERENCE_TIMEOUT')
    expect(provider).toContain('AltheaAiInferenceProcessor')
    expect(provider).toContain('grounded_behavioral_fallback')
  })

  it('keeps execution behind accepted human approval and canonical atomic RPCs', async () => {
    const execution = await readFile(executionPath, 'utf8')
    const kernel = await readFile(kernelPath, 'utf8')
    const migration = await readFile(migrationPath, 'utf8')
    expect(execution).toContain('IaraExecutionKernel')
    expect(execution).toContain('kernel.execute(actionId, user.id)')
    expect(kernel).toMatch(/action\.status\s*!==\s*['"]accepted['"]/) 
    expect(kernel).toContain('HUMAN_APPROVAL_REQUIRED')
    expect(kernel).toContain('tool.executor')
    expect(migration).toContain("status='executing'")
    expect(migration).toContain('crm_operator_send_message')
    expect(migration).toContain("client_message_id=('ai:'||a.id)")
  })
})
