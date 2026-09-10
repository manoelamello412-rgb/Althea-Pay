import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const routePath='app/api/crm/ai-agent/route.ts'
const executePath='app/api/crm/ai-agent/execute/route.ts'
const migrationPath='supabase/migrations/20260910009000_crm_ai_action_channel_aware_execution_v3.sql'

describe('AI revenue agent action ledger contract',()=>{
 it('keeps the agent grounded and human-approved',async()=>{const source=await readFile(routePath,'utf8');expect(source).toContain("human_approval_required:true");expect(source).toContain("source:'crm_ai_agent'")})
 it('persists only controlled decision states and supports request idempotency',async()=>{const source=await readFile(routePath,'utf8');expect(source).toContain("['suggested','accepted','dismissed']");expect(source).toContain("request.headers.get('idempotency-key')");expect(source).toContain('idempotency_key');expect(source).toContain('replayed:true')})
 it('executes through the canonical channel-aware operator path',async()=>{const execute=await readFile(executePath,'utf8');const migration=await readFile(migrationPath,'utf8');expect(execute).toContain('crm_execute_ai_action');expect(migration).toContain('crm_operator_send_message');expect(migration).toContain("client_message_id=('ai:'||a.id)");expect(migration).toContain("status='executing'")})
})
