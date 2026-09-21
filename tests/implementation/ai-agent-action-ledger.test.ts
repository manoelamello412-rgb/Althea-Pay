import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const routePath='app/api/crm/ai-agent/route.ts'
const executePath='app/api/crm/ai-agent/execute/route.ts'
const kernelPath='services/iara-agent/execution-kernel.ts'
const migrationPath='supabase/migrations/20260919213321_advanced_crm_ai_org_authorization.sql'

describe('AI revenue agent action ledger contract',()=>{
 it('keeps the agent grounded and human-approved',async()=>{const source=await readFile(routePath,'utf8');expect(source).toContain("human_approval_required:true");expect(source).toContain("source:'crm_ai_agent'")})
 it('persists only controlled decision states and supports request idempotency',async()=>{const source=await readFile(routePath,'utf8');expect(source).toContain("['suggested','accepted','dismissed']");expect(source).toContain("request.headers.get('idempotency-key')");expect(source).toContain('p_idempotency_key');expect(source).toContain('result.replayed===true')})
 it('executes through the canonical channel-aware operator path',async()=>{const execute=await readFile(executePath,'utf8');const kernel=await readFile(kernelPath,'utf8');const migration=await readFile(migrationPath,'utf8');expect(execute).toContain('IaraExecutionKernel');expect(execute).toContain('kernel.execute(actionId)');expect(kernel).toContain("action.status !== 'accepted'");expect(kernel).toContain('HUMAN_APPROVAL_REQUIRED');expect(kernel).toContain('tool.executor');expect(kernel).toContain("crm_ai_action_get");expect(kernel).toContain("organization_operator");expect(migration).toContain('crm_operator_send_message');expect(migration).toContain("client_message_id=('ai:'||a.id)");expect(migration).toContain("status='executing'")})
})
