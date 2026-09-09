import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json" } });
const valueAt = (o: any, p: string) => p.split(".").reduce((v, k) => v == null ? undefined : v[k], o);
function pass(a: any, op: string, e: any) { switch (op) { case "exists": return e ? a != null : a == null; case "in": return Array.isArray(e) && e.includes(a); case "contains": return typeof a === "string" && a.includes(String(e)); case "eq": return a === e; case "neq": return a !== e; case "gt": return Number(a) > Number(e); case "gte": return Number(a) >= Number(e); case "lt": return Number(a) < Number(e); case "lte": return Number(a) <= Number(e); default: return false; } }
function match(t: any, c: any) { if (t.event_type && t.event_type !== "*" && t.event_type !== c.event_type) return false; if (t.funnel_id && t.funnel_id !== "*" && t.funnel_id !== c.funnel_id) return false; return (Array.isArray(t.conditions) ? t.conditions : []).every((x: any) => pass(valueAt(c.payload, x.field), x.operator || "eq", x.value)); }
async function runAction(rule: any, c: any) {
  const cfg = rule.action_config || {}, type = cfg.type || cfg.action || "log";
  if (type === "log" || type === "alert") { const { error } = await db.from("logs").insert({ id: crypto.randomUUID(), user_id: c.user_id, user_name: "automation", action: `automation:${type}`, resource: c.event_type, details: JSON.stringify({ rule_id: rule.id, funnel_id: c.funnel_id, payload: c.payload }) }); if (error) throw error; return { type, logged: true }; }
  if (type === "send_crm_message") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    const channel = String(cfg.channel || "funnel_chat");
    if (!["funnel_chat"].includes(channel)) throw Error("channel_not_configured");
    const body = String(cfg.body ?? cfg.message ?? "").trim();
    if (!body) throw Error("message_body_required");
    const { data, error } = await db.from("crm_messages").insert({ conversation_id: conversationId, user_id: c.user_id, direction: "outbound", channel, body, metadata: { automation_rule_id: rule.id, automated: true } }).select("id,conversation_id,direction,channel,body,created_at").single();
    if (error) throw error;
    return { type, message: data };
  }
  if (type === "set_conversation_status") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    const status = String(cfg.status || "open");
    if (!["open", "pending", "closed"].includes(status)) throw Error("invalid_conversation_status");
    const { data, error } = await db.from("crm_conversations").update({ status, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", c.user_id).select("id,status,updated_at").single();
    if (error) throw error;
    return { type, conversation: data };
  }
  if (type === "handoff_conversation") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    const assignedTo = String(cfg.assigned_to || cfg.agent_id || "").trim();
    if (!assignedTo) throw Error("assigned_to_required");
    const { data: agent, error: ae } = await db.from("crm_agents").select("id").eq("id", assignedTo).eq("user_id", c.user_id).maybeSingle();
    if (ae) throw ae;
    if (!agent) throw Error("AGENT_NOT_FOUND");
    const { data, error } = await db.from("crm_conversations").update({ assigned_to: assignedTo, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", c.user_id).select("id,assigned_to,updated_at").single();
    if (error) throw error;
    return { type, conversation: data };
  }
  if (type === "update_transaction") {
    if (!c.transaction_id) throw Error("transaction_id_required");
    let data: any = null;
    if (cfg.status) { const { data: transition, error } = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: c.transaction_id, p_user_id: c.user_id, p_next_status: String(cfg.status), p_failure_code: cfg.error_message ? String(cfg.error_message) : null, p_external_id: null }); if (error) throw error; data = transition; }
    if (cfg.error_message) { const { data: updated, error } = await db.from("gateway_transactions").update({ error_message: String(cfg.error_message) }).eq("id", c.transaction_id).eq("user_id", c.user_id).select("id,status,error_message").single(); if (error) throw error; data = updated; }
    if (!data) { const { data: current, error } = await db.from("gateway_transactions").select("id,status,error_message").eq("id", c.transaction_id).eq("user_id", c.user_id).single(); if (error) throw error; data = current; }
    return { type, transaction: data };
  }
  if (type === "recover_checkout") { if (!c.checkout_id) throw Error("checkout_id_required"); const next = new Date(Date.now() + Number(cfg.delay_minutes || 0) * 60000).toISOString(); const { data, error } = await db.from("checkout_sessions").update({ abandoned_at: new Date().toISOString(), recovery_status: "pending", recovery_next_at: next, updated_at: new Date().toISOString() }).eq("id", c.checkout_id).eq("user_id", c.user_id).select("id,recovery_status,recovery_next_at").single(); if (error) throw error; return { type, checkout: data }; }
  if (type === "update_sale") { if (!c.sale_id && !c.external_id) throw Error("sale_identifier_required"); let q = db.from("sales").update({ status: cfg.status || "updated", occurred_at: new Date().toISOString() }).eq("user_id", c.user_id); q = c.sale_id ? q.eq("id", c.sale_id) : q.eq("external_id", c.external_id); const { data, error } = await q.select("id,status").limit(1).single(); if (error) throw error; return { type, sale: data }; }
  throw Error(`unsupported_action:${type}`);
}
Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("ALTHEA_INTERNAL_SECRET") || "";
  if (!secret || req.headers.get("x-internal-secret") !== secret) return json({ error: "unauthorized" }, 401);
  try { const b = await req.json(); const c = { user_id: b.user_id, funnel_id: b.funnel_id ?? null, event_id: b.event_id ?? null, event_type: b.event_type, conversation_id: b.conversation_id ?? b.payload?.conversation_id ?? null, transaction_id: b.transaction_id ?? b.payload?.transaction_id, checkout_id: b.checkout_id ?? b.payload?.checkout_id, sale_id: b.sale_id ?? b.payload?.sale_id, external_id: b.external_id ?? b.payload?.external_id, payload: b.payload ?? {} }; if (!c.user_id || !c.event_type) return json({ error: "user_id_and_event_type_required" }, 400); const { data: rules, error } = await db.from("automation_rules").select("*").eq("user_id", c.user_id).eq("status", "active"); if (error) throw error; const results = []; for (const rule of rules || []) { if (!match(rule.trigger_config || {}, c)) continue; const key = `${c.event_id || `${c.event_type}:${c.funnel_id || "*"}`}:${rule.id}`; const { data: ex, error: ie } = await db.from("automation_executions").insert({ user_id: c.user_id, rule_id: rule.id, event_id: c.event_id, execution_key: key, status: "running", action_type: (rule.action_config || {}).type || (rule.action_config || {}).action || "log", input: c, started_at: new Date().toISOString() }).select("id").single(); if (ie?.code === "23505") { results.push({ rule_id: rule.id, status: "skipped", reason: "duplicate" }); continue; } if (ie) throw ie; try { const output = await runAction(rule, c); await db.from("automation_executions").update({ status: "completed", output, completed_at: new Date().toISOString() }).eq("id", ex.id); results.push({ rule_id: rule.id, status: "completed", output }); } catch (e) { const m = e instanceof Error ? e.message : String(e); await db.from("automation_executions").update({ status: "failed", error_message: m, completed_at: new Date().toISOString() }).eq("id", ex.id); results.push({ rule_id: rule.id, status: "failed", error: m }); } } return json({ ok: true, matched: results.length, results }); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); }
});
