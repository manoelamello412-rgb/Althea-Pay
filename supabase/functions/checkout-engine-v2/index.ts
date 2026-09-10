import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function getUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || !URL || !ANON) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const result = await client.auth.getUser(token);
  return result.error ? null : result.data.user;
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", retryable: false }, 405);
  const user = await getUser(req);
  if (!user) return json({ ok: false, code: "UNAUTHORIZED", retryable: false }, 401);
  if (!URL || !SERVICE) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", retryable: false }, 503);
  const db = createClient(URL, SERVICE);
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400);

  const funnelId = String(body.funnel_id || "").trim();
  const productId = body.product_id ? String(body.product_id).trim() : null;
  const amount = Number(body.amount);
  const currency = String(body.currency || "BRL").toUpperCase();
  const action = body.action === "purchase" ? "purchase" : "start";
  const idempotencyKey = String(req.headers.get("x-idempotency-key") || body.idempotency_key || crypto.randomUUID()).trim();
  if (!funnelId || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !/^[A-Za-z0-9._:-]{1,300}$/.test(idempotencyKey)) return json({ ok: false, code: "INVALID_CHECKOUT", retryable: false }, 422);
  if (["card_data", "pan", "card_number", "cardNumber", "cvv", "cvc"].some(k => body[k] !== undefined)) return json({ ok: false, code: "RAW_CARD_DATA_FORBIDDEN", retryable: false }, 400);

  const funnel = (await db.from("funnels").select("id").eq("id", funnelId).eq("user_id", user.id).is("deleted_at", null).maybeSingle()).data;
  if (!funnel) return json({ ok: false, code: "FUNNEL_NOT_FOUND", retryable: false }, 404);
  if (productId) {
    const product = await db.from("products").select("id").eq("id", productId).eq("user_id", user.id).maybeSingle();
    if (product.error) return json({ ok: false, code: "PRODUCT_LOOKUP_FAILED", retryable: false }, 500);
    if (!product.data) return json({ ok: false, code: "PRODUCT_NOT_FOUND", retryable: false }, 404);
  }

  const customer = isRecord(body.customer) ? body.customer : {};
  const attribution = isRecord(body.attribution) ? body.attribution : {};
  const metadata = { ...(isRecord(body.metadata) ? body.metadata : {}), source: "checkout-engine-v2", idempotency_key: idempotencyKey };
  const checkoutIdempotencyKey = action === "purchase" ? idempotencyKey : `start:${idempotencyKey}`;
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ funnelId, productId, amount, currency, action, customer, attribution, metadata })));
  const requestDigest = Array.from(new Uint8Array(digestBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  const reservation = await db.rpc("reserve_idempotency_key", { p_user_id: user.id, p_scope: `checkout-engine-v2:${funnelId}:${action}`, p_idempotency_key: checkoutIdempotencyKey, p_request_digest: requestDigest, p_ttl: "24 hours" });
  if (reservation.error) return json({ ok: false, code: "IDEMPOTENCY_RESERVATION_FAILED", retryable: false }, 500);
  const row = isRecord(reservation.data) ? reservation.data : Array.isArray(reservation.data) ? reservation.data[0] : null;
  if (!isRecord(row) || !row.acquired) return json({ ok: false, code: "IDEMPOTENCY_CONFLICT", retryable: false, idempotency_key: idempotencyKey }, 409);
  const reservationId = String(row.id || "");
  const leaseToken = row.lease_token ? String(row.lease_token) : null;
  let finalized = false;
  const finish = async (status: "completed" | "failed", code: number, payload: unknown, resourceId?: string) => {
    if (finalized || !reservationId) return;
    const result = await db.rpc("complete_idempotency_key", { p_id: reservationId, p_status: status, p_response_code: code, p_response_payload: payload, p_resource_type: resourceId ? "checkout_session" : null, p_resource_id: resourceId ?? null, p_lease_token: leaseToken });
    if (!result.error) finalized = true;
  };

  try {
    const created = await db.from("checkout_sessions").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, status: action === "purchase" ? "processing" : "started", currency, amount, customer, attribution, metadata, idempotency_key: checkoutIdempotencyKey }).select().single();
    if (created.error) { const p = { ok: false, code: "CHECKOUT_CREATE_FAILED", retryable: false }; await finish("failed", 500, p); return json(p, 500); }
    const checkout = created.data;
    const event = await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: action === "purchase" ? "purchase_requested" : "checkout_started", payload: { funnel_id: funnelId, product_id: productId, amount, currency } });
    if (event.error) { const p = { ok: false, code: "CHECKOUT_EVENT_FAILED", retryable: false }; await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id); await finish("failed", 500, p, String(checkout.id)); return json(p, 500); }
    if (action !== "purchase") { const p = { ok: true, checkout, replayed: false }; await finish("completed", 200, p, String(checkout.id)); return json(p); }

    const tenantId = String(body.tenant_id || "").trim();
    const confirmationId = String(body.confirmation_id || "").trim();
    const evaluationId = String(body.evaluation_id || "").trim();
    const executionId = String(body.execution_id || checkout.id).trim();
    if (!tenantId || !confirmationId || !evaluationId) {
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      const p = { ok: false, code: "FINANCIAL_EXECUTION_DENIED", reason: "CONFIRMATION_REQUIRED", executionId, retryable: false, checkout }; await finish("completed", 409, p, String(checkout.id)); return json(p, 409);
    }

    const members = await db.from("organization_members").select("role").eq("organization_id", tenantId).eq("user_id", user.id).maybeSingle();
    if (members.error || !members.data || !["owner", "admin", "manager", "operator", "supervisor"].includes(members.data.role)) { const p = { ok: false, code: "FINANCIAL_EXECUTION_DENIED", reason: "AUTHORIZATION_DENIED", executionId, retryable: false }; await finish("failed", 403, p, String(checkout.id)); return json(p, 403); }

    const febResponse = await fetch(`${URL}/functions/v1/iara-financial-command`, { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.get("authorization") || "", "x-idempotency-key": idempotencyKey }, body: JSON.stringify({ tenant_id: tenantId, gateway_id: String(body.gateway_id || "").trim(), action: "purchase", idempotency_key: idempotencyKey, confirmation_id: confirmationId, evaluation_id: evaluationId, execution_id: executionId, tool_key: "gateway.financial-command", tool_version: 1, input: { funnel_id: funnelId, product_id: productId, amount, currency, customer, metadata: { ...metadata, checkout_id: checkout.id } } }) });
    const feb = await febResponse.json().catch(() => ({ ok: false, code: "FEB_INVALID_RESPONSE" }));
    if (!febResponse.ok || !isRecord(feb) || typeof feb.febTicket !== "string") {
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      const p = { ok: false, code: isRecord(feb) && typeof feb.code === "string" ? feb.code : "FINANCIAL_EXECUTION_DENIED", reason: isRecord(feb) && typeof feb.reason === "string" ? feb.reason : "FEB_AUTHORIZATION_FAILED", executionId, retryable: false, checkout, feb }; await finish("completed", febResponse.status >= 400 && febResponse.status < 500 ? febResponse.status : 503, p, String(checkout.id)); return json(p, febResponse.status >= 400 && febResponse.status < 500 ? febResponse.status : 503);
    }

    const gatewayResponse = await fetch(`${URL}/functions/v1/gateway-orchestrator`, { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.get("authorization") || "", "x-idempotency-key": idempotencyKey, "X-Althea-FEB-Ticket-Signature": feb.febTicket }, body: JSON.stringify({ funnel_id: funnelId, product_id: productId, amount, currency, customer, metadata: { ...metadata, checkout_id: checkout.id }, idempotency_key: idempotencyKey }) });
    const gateway = await gatewayResponse.json().catch(() => ({ ok: false, code: "GATEWAY_INVALID_RESPONSE" }));
    if (!gatewayResponse.ok) {
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      const p = { ok: false, code: isRecord(gateway) && typeof gateway.code === "string" ? gateway.code : "EXECUTION_UNAVAILABLE", reason: isRecord(gateway) && typeof gateway.reason === "string" ? gateway.reason : "GATEWAY_EXECUTION_BLOCKED", executionId, retryable: false, checkout, gateway }; await finish("completed", gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? gatewayResponse.status : 503, p, String(checkout.id)); return json(p, gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? gatewayResponse.status : 503);
    }

    const p = { ok: true, checkout, gateway, executionId, replayed: false }; await finish("completed", 200, p, String(checkout.id)); return json(p);
  } catch (error) {
    const p = { ok: false, code: "CHECKOUT_UNHANDLED_ERROR", retryable: false }; await finish("failed", 500, p); console.error("checkout-engine-v2", error instanceof Error ? error.message : "unknown_error"); return json(p, 500);
  } finally {
    if (!finalized && reservationId) await finish("failed", 500, { ok: false, code: "CHECKOUT_ABORTED", retryable: false });
  }
});
