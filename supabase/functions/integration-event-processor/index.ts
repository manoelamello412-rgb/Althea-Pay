import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const aliases: Record<string, string> = { paid: "approved", completed: "approved", success: "approved", refund: "refunded", reversed: "refunded", charged_back: "chargeback" };
const normalize = (value: unknown) => aliases[String(value ?? "").trim().toLowerCase()] ?? String(value ?? "").trim().toLowerCase();
const allowed: Record<string, string[]> = { created: ["created", "pending", "approved", "failed"], pending: ["pending", "approved", "failed", "refunded", "chargeback"], approved: ["approved", "refunded", "chargeback"], failed: ["failed"], refunded: ["refunded"], chargeback: ["chargeback"] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) return json({ ok: false, error: "unauthorized" }, 401);
  let eventId = "";
  try {
    const body = await req.json() as { event_id?: string };
    eventId = String(body.event_id ?? "");
    if (!eventId) return json({ ok: false, error: "event_id_required" }, 400);
    const claim = await db.rpc("claim_integration_event", { p_event_id: eventId });
    if (claim.error) throw claim.error;
    if (!claim.data) {
      const existing = await db.from("integration_events").select("status").eq("id", eventId).maybeSingle();
      if (existing.data?.status === "processed") return json({ ok: true, already_processed: true, event_id: eventId });
      return json({ ok: false, error: "event_already_processing_or_unavailable", event_id: eventId }, 409);
    }
    const { data: event, error: eventError } = await db.from("integration_events").select("*").eq("id", eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return json({ ok: false, error: "event_not_found" }, 404);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const userId = String(event.user_id);
    const transactionId = payload.transaction_id ? String(payload.transaction_id) : "";
    const checkoutId = payload.checkout_id ? String(payload.checkout_id) : "";
    const status = normalize(payload.status);
    let tx: Record<string, any> | null = null;
    if (transactionId) {
      const result = await db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", userId).maybeSingle();
      if (result.error) throw result.error;
      tx = result.data;
      if (tx && allowed[normalize(tx.status)]?.includes(status)) {
        const transition = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: tx.id, p_user_id: userId, p_next_status: status, p_failure_code: payload.failure_code ? String(payload.failure_code) : null, p_external_id: payload.external_id ? String(payload.external_id) : null });
        if (transition.error) throw transition.error;
        tx = Array.isArray(transition.data) ? transition.data[0] : transition.data;
      }
    }
    if (checkoutId) {
      const next = status === "approved" ? "completed" : ["refunded", "chargeback"].includes(status) ? "failed" : null;
      if (next) {
        const result = await db.from("checkout_sessions").update({ status: next, completed_at: next === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", checkoutId).eq("user_id", userId);
        if (result.error) throw result.error;
      }
    }
    if (status === "approved" && tx) {
      const externalId = String(payload.external_id ?? tx.external_id ?? event.external_id ?? event.id);
      const existing = await db.from("sales").select("id").eq("user_id", userId).eq("external_id", externalId).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) {
        const sale = await db.from("sales").insert({ id: `sale_${String(event.external_id ?? event.id)}`, user_id: userId, funnel_id: event.funnel_id, checkout_id: checkoutId || null, transaction_id: tx.id, product_id: tx.product_id ?? null, amount: tx.amount ?? payload.amount ?? 0, currency: tx.currency ?? payload.currency ?? "BRL", status: "approved", external_id: externalId, gateway_id: tx.gateway_id ?? null, data: payload, occurred_at: event.occurred_at ?? new Date().toISOString() });
        if (sale.error && sale.error.code !== "23505") throw sale.error;
      }
    }
    if (["refunded", "chargeback"].includes(status)) {
      const externalId = String(payload.external_id ?? tx?.external_id ?? event.external_id ?? event.id);
      const result = await db.from("sales").update({ status, data: payload }).eq("user_id", userId).eq("external_id", externalId);
      if (result.error) throw result.error;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const automation = await fetch(`${supabaseUrl}/functions/v1/automation-engine-v2`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-internal-secret": internalSecret }, body: JSON.stringify({ user_id: userId, funnel_id: event.funnel_id, event_id: event.id, event_type: event.event_type, transaction_id: transactionId || null, checkout_id: checkoutId || null, external_id: payload.external_id ?? null, payload }) });
      if (!automation.ok) throw new Error(`automation_http_${automation.status}`);
    } finally {
      clearTimeout(timer);
    }
    const done = await db.rpc("mark_integration_event_processed", { p_event_id: eventId, p_status: "processed", p_error: null });
    if (done.error) throw done.error;
    return json({ ok: true, processed: true, event_id: eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (eventId) await db.rpc("mark_integration_event_processed", { p_event_id: eventId, p_status: "retry", p_error: message }).catch(() => undefined);
    return json({ ok: false, error: "integration_event_processing_failed" }, 500);
  }
});
