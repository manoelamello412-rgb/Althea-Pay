import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const migration = readFileSync(resolve(root, "supabase/migrations/20260910023000_crm_advanced_automation_governance_v3_fix_execution_columns.sql"), "utf8");
const alignment = readFileSync(resolve(root, "supabase/migrations/20260910023100_crm_automation_execution_updated_at_alignment_v1.sql"), "utf8");

describe("advanced automation governance", () => {
  it("has canonical retry, scheduling, cancellation and replay RPCs", () => {
    expect(migration).toContain("crm_claim_automation_retries");
    expect(migration).toContain("crm_claim_scheduled_automation_executions");
    expect(migration).toContain("crm_cancel_automation_execution");
    expect(migration).toContain("crm_mark_automation_dead_letter");
    expect(migration).toContain("crm_replay_automation_execution");
  });

  it("uses row locking and skip-locked claiming for concurrent workers", () => {
    expect(migration).toContain("for update skip locked");
  });

  it("preserves physical execution lifecycle timestamps", () => {
    expect(alignment).toContain("crm_touch_automation_execution_updated_at");
    expect(alignment).toContain("trg_crm_touch_automation_execution_updated_at");
  });

  it("does not introduce the rejected parallel workflow schema", () => {
    expect(migration).not.toContain("crm_workflows");
    expect(migration).not.toContain("crm_workflow_steps");
    expect(migration).not.toContain("crm_workflow_executions");
    expect(migration).not.toContain("crm_automation_rate_limits");
  });
});
