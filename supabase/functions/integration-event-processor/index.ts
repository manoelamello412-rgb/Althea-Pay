import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const aliases: Record<string, string> = { paid: "approved", completed: "approved", success: "approved", refund: "refunded", reversed: "refunded", charged_back: "chargeback" };
const normalize = (value: unknown) => aliases[String(value ?? "").trim().toLowerCase()] ?? String(value ?? "").trim().toLowerCase();
const allowed: Record<string, string[]> = { created: ["created", "pending", "approved", "failed"], pending: ["pending", "approved", "failed", "refunded", "chargeback"], approved: ["approved", "refunded", "chargeback"], failed: ["failed"], refunded: ["refunded"], chargeback: ["chargeback"] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const suppliedSecret = req.headers.get("x-internal-secret") ?? req.headers.get("x-althea-internal-secret") ?? "";
  if (!suppliedSecret) return json({ ok: false, error: "unauthorized" }, 401);
  const verified = await db.rpc("verify_althea_internal_secret", { p_secret: suppliedSecret });
  if (verified.error) return json({ ok: false, error: "internal_auth_unavailable" }, 500);
  if (verified.data !== true) return json({ ok: false, error: "unauthorized" }, 401);
  const canonical = await db.rpc("get_althea_internal_secret");
  if (canonical.error || typeof canonical.data !== "string" || !canonical.data) return json({ ok: false, error: "internal_auth_unavailable" }, 500);
  const internalSecret = canonical.data;
  let eventId = "";
  let tenantUserId = "";
  let tenantOrganizationId = "";
  let eventClaimed = false;
  try {
    const body = await req.json() as { event_id?: string };
    eventId = String(body.event_id ?? "");
    if (!eventId) return json({ ok: false, error: "event_id_required" }, 400);
    const { data: event, error: eventError } = await db.from("integration_events").select("*").eq("id", eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return json({ ok: false, error: "event_not_found" }, 404);
    const userId = String(event.user_id);
    const organizationId = String(event.organization_id ?? "").trim();
    if (!uuid(organizationId)) throw new Error("integration_event_organization_invalid");
    tenantUserId = userId;
    tenantOrganizationId = organizationId;
    const claim = await db.rpc("server_claim_integration_event_v1", {
      p_event_id: eventId,
      p_user_id: userId,
      p_organization_id: organizationId,
      p_increment_retry_count: false,
    });
    if (claim.error) throw claim.error;
    if (claim.data !== true) {
      const existing = await db.from("integration_events").select("status").eq("id", eventId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data?.status === "processed") return json({ ok: true, already_processed: true, event_id: eventId });
      return json({ ok: false, error: "event_already_processing_or_unavailable", event_id: eventId }, 409);
    }
    eventClaimed = true;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const organization = await db.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (organization.error) throw organization.error;
    if (!organization.data) throw new Error("integration_event_organization_not_found");
    const transactionId = payload.transaction_id ? String(payload.transaction_id) : "";
    const checkoutId = payload.checkout_id ? String(payload.checkout_id) : "";
    const status = normalize(payload.status);
    let tx: Record<string, any> | null = null;
    if (transactionId) {
      const result = await db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("transaction_tenant_mismatch_or_not_found");
      tx = result.data;
      if (allowed[normalize(tx.status)]?.includes(status)) {
        const transition = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: tx.id, p_user_id: userId, p_next_status: status, p_failure_code: payload.failure_code ? String(payload.failure_code) : null, p_external_id: payload.external_id ? String(payload.external_id) : null, p_expected_version: Number(tx.version) });
        if (transition.error) throw transition.error;
        tx = Array.isArray(transition.data) ? transition.data[0] : transition.data;
        if (!tx || String(tx.organization_id) !== organizationId || String(tx.user_id) !== userId) throw new Error("transaction_transition_tenant_mismatch");
      }
    }
    if (checkoutId) {
      const checkout = await db.from("checkout_sessions").select("id,user_id,organization_id").eq("id", checkoutId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle();
      if (checkout.error) throw checkout.error;
      if (!checkout.data) throw new Error("checkout_tenant_mismatch_or_not_found");
      const next = status === "approved" ? "completed" : ["refunded", "chargeback"].includes(status) ? "failed" : null;
      if (next) {
        const result = await db.from("checkout_sessions").update({ status: next, completed_at: next === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", checkoutId).eq("user_id", userId).eq("organization_id", organizationId).select("id").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("checkout_update_tenant_mismatch");
      }
    }
    let saleId: string | null = null;
    if (status === "approved" && tx) {
      const externalId = String(payload.external_id ?? tx.external_id ?? event.external_id ?? event.id);
      const sale = await db.rpc("server_upsert_transaction_sale_v1", {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_transaction_id: tx.id,
        p_funnel_id: event.funnel_id,
        p_product_id: tx.product_id ?? null,
        p_checkout_id: checkoutId || null,
        p_amount: tx.amount ?? payload.amount ?? 0,
        p_currency: tx.currency ?? payload.currency ?? "BRL",
        p_attribution: {},
        p_external_id: externalId,
        p_occurred_at: event.occurred_at ?? new Date().toISOString(),
        p_data: payload,
      });
      if (sale.error) throw sale.error;
      saleId = sale.data ? String(sale.data) : null;
    }
    if (["refunded", "chargeback"].includes(status)) {
      const externalId = String(payload.external_id ?? tx?.external_id ?? event.external_id ?? event.id);
      const updated = await db.rpc("server_update_sale_status_v1", {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_status: status,
        p_sale_id: saleId,
        p_transaction_id: tx?.id ?? null,
        p_external_id: externalId,
        p_data: payload,
        p_occurred_at: null,
      });
      if (updated.error) throw updated.error;
      if (updated.data) saleId = String(updated.data);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const automation = await fetch(`${supabaseUrl}/functions/v1/automation-engine-v2`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-internal-secret": internalSecret }, body: JSON.stringify({ user_id: userId, organization_id: event.organization_id, funnel_id: event.funnel_id, event_id: event.id, event_type: event.event_type, transaction_id: transactionId || null, checkout_id: checkoutId || null, sale_id: saleId, external_id: payload.external_id ?? null, payload }) });
      if (!automation.ok) throw new Error(`automation_http_${automation.status}`);
    } finally {
      clearTimeout(timer);
    }
    const done = await db.rpc("server_complete_integration_event_v1", {
      p_event_id: eventId,
      p_user_id: userId,
      p_organization_id: organizationId,
      p_expected_status: "processing",
    });
    if (done.error || done.data !== true) throw done.error ?? new Error("integration_event_complete_rejected");
    return json({ ok: true, processed: true, event_id: eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (eventClaimed && eventId && tenantUserId && tenantOrganizationId) {
      const failed = await db.rpc("server_fail_integration_event_v1", {
        p_event_id: eventId,
        p_user_id: tenantUserId,
        p_organization_id: tenantOrganizationId,
        p_next_status: "retry",
        p_expected_status: "processing",
        p_retry_count: null,
        p_error: message,
        p_next_retry_at: null,
      });
      if (failed.error || failed.data !== true) console.error("integration_event_retry_transition_failed", failed.error ?? "transition_rejected");
    }
    return json({ ok: false, error: "integration_event_processing_failed" }, 500);
  }
});