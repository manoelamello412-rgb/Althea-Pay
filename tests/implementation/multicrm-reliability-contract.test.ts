import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root=resolve(process.cwd())
const read=(p:string)=>readFileSync(resolve(root,p),'utf8')

describe('Multi-CRM reliability contracts',()=>{
 it('ships delivery audit, predictive worker and idempotent delivery callback contracts',()=>{
  const migration=read('supabase/migrations/20260909231500_crm_delivery_idempotency_v2.sql')
  const worker=read('supabase/functions/crm-predictive-outcome-worker/index.ts')
  expect(migration).toContain('crm_channel_delivery_events_dedupe_idx')
  expect(migration).toContain('on conflict(channel_account_id,external_message_id,status,(md5(provider_event::text))) do nothing')
  expect(worker).toContain('crm_predictive_capture_outcomes')
  expect(worker).toContain('x-internal-secret')
 })
 it('keeps customer-facing AI execution human-approved, bounded and atomic',()=>{
  const route=read('app/api/crm/ai-agent/execute/route.ts')
  const migration=read('supabase/migrations/20260909232000_crm_ai_action_atomic_execution_v2.sql')
  expect(route).toContain("action.status!=='accepted'")
  expect(route).toContain('AI_DRAFT_REJECTED')
  expect(route).not.toContain('auto_charge')
  expect(migration).toContain("status='executing'")
  expect(migration).toContain("client_message_id=('ai:'||a.id)")
 })
 it('enforces guarded experiment promotion instead of silent winner activation',()=>{
  const migration=read('supabase/migrations/20260909230000_crm_experiment_governance_v4.sql')
  const sequential=read('supabase/migrations/20260910004000_crm_experiment_sequential_guardrails_v7.sql')
  const idempotency=read('supabase/migrations/20260910005000_crm_experiment_outcome_idempotency_v8.sql')
  expect(migration).toContain('crm_experiment_promote_winner')
  expect(migration).toContain('winner_not_eligible')
  expect(migration).toContain("status','approved'")
  expect(sequential).toContain('bonferroni_repeated_look_conservative_v1')
  expect(sequential).toContain('wilson_lower')
  expect(sequential).toContain('eligible_for_winner')
  expect(idempotency).toContain('crm_exp_outcome_subject_once_uidx')
 })
 it('keeps automation attempt auditing owner-scoped and initplan-safe',()=>{
  const base=read('supabase/migrations/20260910002000_crm_automation_attempt_audit_v3.sql')
  const cleanup=read('supabase/migrations/20260910003000_crm_automation_attempts_rls_cleanup_v4.sql')
  expect(base).toContain('trg_crm_automation_attempt_audit')
  expect(base).toContain('unique(execution_id,attempt_no)')
  expect(cleanup).toContain('user_id=(select auth.uid())')
  expect(cleanup).toContain('automation_attempts_execution_idx')
 })
 it('keeps asynchronous CRM work bounded',()=>{
  const workflow=read('.github/workflows/crm-workers.yml')
  expect(workflow).toContain("cron: '*/5 * * * *'")
  expect(workflow).toContain('Capture predictive outcomes')
  expect(workflow).toContain('Retry failed CRM automations')
 })
})
