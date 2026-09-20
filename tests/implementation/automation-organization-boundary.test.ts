import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const enginePath = "supabase/functions/automation-engine-v2/index.ts";
const eventWorkerPath = "supabase/functions/event-worker/index.ts";
const webhookPath = "supabase/functions/althea-webhook/index.ts";

describe("automation organization boundary", () => {
  it("preserves and validates organization context", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toContain("organization_id: body.organization_id");
    expect(source).toContain('from("organizations")');
    expect(source).toContain('from("organization_members")');
    expect(source).toContain('eq("organization_id", c.organization_id)');
    expect(source).toContain("organization_membership_required");
  });

  it("scopes active rules and execution rows to organization", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toMatch(/from\("automation_rules"\)[\s\S]*?eq\("user_id", c\.user_id\)[\s\S]*?eq\("organization_id", c\.organization_id\)[\s\S]*?eq\("status", "active"\)/);
    expect(source).toContain("organization_id: c.organization_id");
    expect(source).toContain("input: c");
    expect(source).toContain('crm_check_automation_rate_limit_org');
  });

  it("keeps retry execution rule and input in the same organization", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toContain("id,user_id,organization_id,rule_id,status,input,attempt_count,max_attempts");
    expect(source).toContain('retry_rule_organization_mismatch');
    expect(source).toContain('retry_input_organization_mismatch');
    expect(source).toContain('eq("organization_id", execution.organization_id)');
  });

  it("scopes transactional actions to organization", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toMatch(/from\("gateway_transactions"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toMatch(/from\("checkout_sessions"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toMatch(/from\("sales"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toContain("SALE_EXTERNAL_ID_AMBIGUOUS");
    expect(source).toContain("p_expected_version: Number(current.version)");
  });

  it("scopes CRM conversations agents accounts messages and outbox", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toMatch(/from\("crm_conversations"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toMatch(/from\("crm_agents"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toMatch(/from\("crm_channel_accounts"\)[\s\S]*?eq\("organization_id", c\.organization_id\)/);
    expect(source).toMatch(/from\("crm_messages"\)\.insert\(\{[\s\S]*?organization_id: c\.organization_id/);
    expect(source).toMatch(/from\("crm_channel_message_outbox"\)\.upsert\(\{[\s\S]*?organization_id: c\.organization_id/);
  });

  it("includes organization in automation idempotency keys", async () => {
    const source = await readFile(enginePath, "utf8");
    expect(source).toContain('return `${c.organization_id}:${String(explicit)}:${ruleId}`');
    expect(source).toContain('automation:${c.organization_id}:${rule.id}:');
  });

  it("propagates organization from integration events", async () => {
    const source = await readFile(eventWorkerPath, "utf8");
    expect(source).toContain("id,user_id,organization_id,funnel_id");
    expect(source).toContain("organization_id: event.organization_id");
  });

  it("resolves and propagates organization from webhook integration", async () => {
    const source = await readFile(webhookPath, "utf8");
    expect(source).toContain("select('organization_id')");
    expect(source).toContain("organization_id: organizationId");
    expect(source).toContain("webhook_organization_required");
  });
});
