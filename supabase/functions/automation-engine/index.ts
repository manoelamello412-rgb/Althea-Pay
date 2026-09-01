import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function valueAt(obj: any, path: string) { return path.split(".").reduce((v, k) => v == null ? undefined : v[k], obj); }
function conditionPasses(actual: any, operator: string, expected: any) {
  if (operator === "exists") return expected ? actual != null : actual == null;
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (operator === "contains") return typeof actual === "string" && actual.includes(String(expected));
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "gt") return Number(actual) > Number(expected);
  if (operator === "gte") return Number(actual) >= Number(expected);
  if (operator === "lt") return Number(actual) < Number(expected);
  if (operator === "lte") return Number(actual) <= Number(expected);
  return false;
}
function matches(trigger: any, ctx: any) {
  if (trigger.event_type && trigger.event_type !== "*" && trigger.event_type !== ctx.event_type) return false;
  if (trigger.funnel_id && trigger.funnel_id !== "*" && trigger.funnel_id !== ctx.funnel_id) return false;
  const conditions = Array.isArray(trigger.conditions) ? trigger.conditions : [];
  return conditions.every((c: any) => conditionPasses(valueAt(ctx.payload, c.field), c.operator ?? "eq", c.value));
}

async function action(rule: any, ctx: any) {
  const cfg = rule.action_config ?? {};
  const type = cfg.type ?? cfg.action ?? "log";
  if (type === "log" || type === "alert") {
    await db.from("logs").insert({ id: crypto.randomUUID(), user_id: ctx.user_id, user_name: "automation", action: `automation:${type}`, resource: ctx.event_type, details: JSON.stringify({ rule_id: rule.id, funnel_id: ctx.funnel_id, payload: ctx.payload }) });
    return { type, logged: true };
  }
  if (type === "update_transaction") {
    if (!ctx.transaction_id) throw new Error("transaction_id_required");
    const patch: any = {};
    if (cfg.status) patch.status = cfg.status;
    if (cfg.error_message) patch.error_message = cfg.error_message;
    if (["approved", "refunded", "chargeback"].includes(cfg.status)) patch.completed_at = new Date().toISOString();
    const { data, error } = await db.from("gateway_transactions").update(patch).eq("id", ctx.transaction_id).eq("user_id", ctx.user_id).select("id,status").single();
    if (error) throw error;
    return { type, transaction: data };
  }
  if (type === "recover_checkout") {
    if (!ctx.checkout_id) throw new Error("checkout_id_required");
    const next = new Date(Date.now() + Number(cfg.delay_minutes ?? 0) * 60000).toISOString();
    const { data, error } = await db.from("checkout_sessions").update({ abandoned_at: new Date().toISOString(), recovery_status: "pending", recovery_next_at: next, updated_at: new Date().toISOString() }).eq("id", ctx.checkout_id).eq("user_id", ctx.user_id).select("id,recovery_status,recovery_next_at").single();
    if (error) throw error;
    await db.from("recovery_events").insert({ user_id: ctx.user_id, checkout_id: ctx.checkout_id, event_type: "automation_scheduled", status: "pending", payload: { rule_id: rule.id, event_type: ctx.event_type } });
    return { type, checkout: data };
  }
  if (type === "update_sale") {
    if (!ctx.sale_id && !ctx.external_id) throw new Error("sale_identifier_required");
    let q = db.from("sales").update({ status: cfg.status ?? "updated", occurred_at: new Date().toISOString() }).eq("user_id", ctx.user_id);
    q = ctx.sale_id ? q.eq("id", ctx.sale_id) : q.eq("external_id", ctx.external_id);
    const { data, error } = await q.select("id,status").limit(1).single();
    if (error) throw error;
    return { type, sale: data };
  }
  throw new Error(`unsupported_action:${type}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return response({ ok: true });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return response({ error: "unauthorized" }, 401);
  try {
    const body = await req.json();
    const ctx = { user_id: body.user_id, funnel_id: body.funnel_id ?? null, event_id: body.event_id ?? null, event_type: body.event_type, transaction_id: body.transaction_id ?? body.payload?.transaction_id, checkout_id: body.checkout_id ?? body.payload?.checkout_id, sale_id: body.sale_id ?? body.payload?.sale_id, external_id: body.external_id ?? body.payload?.external_id, payload: body.payload ?? {} };
    if (!ctx.user_id || !ctx.event_type) return response({ error: "user_id_and_event_type_required" }, 400);
    const { data: rules, error } = await db.from("automation_rules").select("*").eq("user_id", ctx.user_id).eq("status", "active");
    if (error) throw error;
    const results = [];
    for (const rule of rules ?? []) {
      if (!matches(rule.trigger_config ?? {}, ctx)) continue;
      const executionKey = `${ctx.event_id ?? `${ctx.event_type}:${ctx.funnel_id ?? "*"}`}:${rule.id}`;
      const { data: execution, error: insertError } = await db.from("automation_executions").insert({ user_id: ctx.user_id, rule_id: rule.id, event_id: ctx.event_id, execution_key: executionKey, status: "running", action_type: (rule.action_config ?? {}).type ?? (rule.action_config ?? {}).action ?? "log", input: ctx, started_at: new Date().toISOString() }).select("id").single();
      if (insertError?.code === "23505") { results.push({ rule_id: rule.id, status: "skipped", reason: "duplicate" }); continue; }
      if (insertError) throw insertError;
      try {
        const output = await action(rule, ctx);
        await db.from("automation_executions").update({ status: "completed", output, completed_at: new Date().toISOString() }).eq("id", execution.id);
        results.push({ rule_id: rule.id, status: "completed", output });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await db.from("automation_executions").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", execution.id);
        results.push({ rule_id: rule.id, status: "failed", error: message });
      }
    }
    return response({ ok: true, matched: results.length, results });
  } catch (e) { return response({ error: e instanceof Error ? e.message : String(e) }, 500); }
});
