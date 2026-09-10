import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const governance = readFileSync(resolve(root, "supabase/migrations/20260910023000_crm_advanced_automation_governance_v3_fix_execution_columns.sql"), "utf8");
const alignment = readFileSync(resolve(root, "supabase/migrations/20260910023100_crm_automation_execution_updated_at_alignment_v1.sql"), "utf8");
const replay = readFileSync(resolve(root, "supabase/migrations/20260910163304_crm_advanced_automation_replay_idempotency_v1.sql"), "utf8");
const cancel = readFileSync(resolve(root, "supabase/migrations/20260910163654_crm_advanced_automation_cancel_ownership_v1.sql"), "utf8");

describe("advanced automation governance", () => {
  it("has canonical retry, scheduling, cancellation and replay RPCs", () => {
    expect(governance).toContain("crm_claim_automation_retries");
    expect(governance).toContain("crm_claim_scheduled_automation_executions");
    expect(governance).toContain("crm_cancel_automation_execution");
    expect(governance).toContain("crm_mark_automation_dead_letter");
    expect(governance).toContain("crm_replay_automation_execution");
  });
  it("uses row locking and skip-locked claiming for concurrent workers", () => { expect(governance).toContain("for update skip locked"); });
  it("preserves physical execution lifecycle timestamps", () => { expect(alignment).toContain("crm_touch_automation_execution_updated_at"); expect(alignment).toContain("trg_crm_touch_automation_execution_updated_at"); });
  it("makes replay idempotent and auditable", () => { expect(replay).toContain("scope='automation_replay'"); expect(replay).toContain("for update"); expect(replay).toContain("automation.replay"); expect(replay).toContain("response_code=200"); });
  it("enforces tenant ownership on cancellation", () => { expect(cancel).toContain("id=p_execution_id and user_id=auth.uid()"); expect(cancel).toContain("REVOKE ALL ON FUNCTION public.crm_cancel_automation_execution(uuid,text) FROM PUBLIC, anon"); });
  it("does not introduce the rejected parallel workflow schema", () => { expect(governance).not.toContain("crm_workflows"); expect(governance).not.toContain("crm_workflow_steps"); expect(governance).not.toContain("crm_workflow_executions"); expect(governance).not.toContain("crm_automation_rate_limits"); });
});
