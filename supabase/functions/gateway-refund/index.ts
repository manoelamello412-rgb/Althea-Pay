import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Row = { id: string; user_id: string; funnel_id: string; product_id: string | null; gateway_id: string; external_id: string | null; amount: number; currency: string; status: string; customer: Record<string, unknown> | null; metadata: Record<string, unknown> | null; };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key, idempotency-key", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
async function digest(v: unknown) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(v))); return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, "0")).join(""); }
const provider = (g: Record<string, unknown> | null, id: string) => String(g?.provider ?? g?.gateway_name ?? g?.name ?? g?.type ?? id).trim().toLowerCase();
const environment = (g: Record<string, unknown> | null) => String(g?.environment ?? g?.env ?? "production").trim().toLowerCase();

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "server_configuration_error" }, 500);
  const authz = req.headers.get("Authorization") ?? "";
  const uc = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const db = createClient(url, service);
  const { data: auth, error: authError } = await uc.auth.getUser();
  if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { const parsed = await req.json(); if (!rec(parsed)) return json({ error: "invalid_json" }, 400); body = parsed; } catch { return json({ error: "invalid_json" }, 400); }
  const uid = auth.user.id;
  const transactionId = body.transaction_id ? String(body.transaction_id) : "";
  const externalId = body.external_transaction_id ? String(body.external_transaction_id) : "";
  const key = String(body.idempotency_key ?? req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key") ?? "");
  if ((!transactionId && !externalId) || !key) return json({ error: "transaction_id_or_external_transaction_id_and_idempotency_key_required" }, 400);
  if (key.length > 200) return json({ error: "idempotency_key_too_long" }, 400);
  const lookup = db.from("gateway_transactions").select("id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,customer,metadata").eq("user_id", uid);
  const { data: tx, error: txError } = transactionId ? await lookup.eq("id", transactionId).maybeSingle() : await lookup.eq("external_id", externalId).maybeSingle();
  if (txError) return json({ error: "transaction_lookup_failed" }, 500);
  if (!tx) return json({ error: "transaction_not_found" }, 404);
  const row = tx as Row;
  if (row.status === "refunded") return json({ error: "transaction_already_refunded", transaction_id: row.id }, 409);
  if (row.status !== "approved") return json({ error: "transaction_not_refundable", status: row.status }, 409);
  if (!row.external_id) return json({ error: "external_transaction_id_required" }, 409);
  const requestDigest = await digest({ transaction_id: row.id, amount: row.amount, currency: row.currency, external_id: row.external_id });
  const { data: reservation, error: reservationError } = await db.rpc("reserve_idempotency_key", { p_user_id: uid, p_scope: `gateway-refund:${row.id}`, p_idempotency_key: key, p_request_digest: requestDigest, p_ttl: "24 hours" });
  if (reservationError) return json({ error: "idempotency_reservation_failed" }, 500);
  const r = Array.isArray(reservation) ? reservation[0] as Record<string, unknown> | undefined : undefined;
  if (!r?.acquired) { if (r?.response_payload) return json(r.response_payload, Number(r.response_code ?? 200)); return json({ error: "request_in_progress", idempotency_key: key }, 409); }
  const reservationId = String(r.id ?? "");
  const leaseToken = r.lease_token ? String(r.lease_token) : null;
  const complete = async (status: string, code: number, payload: unknown, resourceId: string | null = null) => { if (reservationId) await db.rpc("complete_idempotency_key", { p_id: reservationId, p_status: status, p_response_code: code, p_response_payload: payload, p_resource_type: "gateway_transaction", p_resource_id: resourceId, p_lease_token: leaseToken }); };
  try {
    const { data: gateway, error: gatewayError } = await db.from("gateways").select("id,data").eq("id", row.gateway_id).eq("user_id", uid).maybeSingle();
    if (gatewayError || !gateway) { const p = { error: "gateway_not_found" }; await complete("failed", 404, p); return json(p, 404); }
    const gdata = rec(gateway.data) ? gateway.data : {};
    const p = provider(gdata, row.gateway_id);
    const sandbox = environment(gdata) !== "production" || p === "sandbox";
    let result: Record<string, unknown>;
    if (sandbox) result = { ok: true, external_id: row.external_id, status: "refunded" };
    else {
      const adapterUrlName = `GATEWAY_ADAPTER_URL_${p.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
      const base = Deno.env.get("GATEWAY_ADAPTER_BASE_URL")?.replace(/\/$/, "");
      const endpoint = Deno.env.get(adapterUrlName) ?? (base ? `${base}/adapters/${encodeURIComponent(p)}` : "");
      if (!endpoint) { const x = { error: "adapter_url_not_configured" }; await complete("failed", 503, x); return json(x, 503); }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3900);
      try {
        const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "X-Althea-Gateway-Id": row.gateway_id, "X-Althea-Idempotency-Key": key }, body: JSON.stringify({ operation: "refund", transaction_id: row.id, external_transaction_id: row.external_id, amount: row.amount, currency: row.currency, product_id: row.product_id, funnel_id: row.funnel_id, customer: row.customer, metadata: row.metadata, idempotency_key: key }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) { const x = { error: "gateway_refund_failed", gateway_status: response.status }; await complete("failed", response.status >= 400 && response.status < 600 ? response.status : 502, x); return json(x, response.status >= 400 && response.status < 600 ? response.status : 502); }
        result = { ok: payload?.approved === true || String(payload?.status ?? "").toLowerCase() === "refunded" || String(payload?.status ?? "").toLowerCase() === "success", external_id: String(payload?.id ?? payload?.transaction_id ?? row.external_id), status: String(payload?.status ?? "refunded") };
      } catch (e) { const x = { error: e instanceof DOMException && e.name === "AbortError" ? "gateway_refund_timeout" : "gateway_refund_request_failed" }; await complete("failed", e instanceof DOMException && e.name === "AbortError" ? 504 : 503, x); return json(x, e instanceof DOMException && e.name === "AbortError" ? 504 : 503); } finally { clearTimeout(timer); }
    }
    if (result.ok !== true) { const p = { error: "gateway_refund_rejected" }; await complete("failed", 402, p); return json(p, 402); }
    const { data: transitioned, error: transitionError } = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: row.id, p_user_id: uid, p_next_status: "refunded", p_failure_code: null, p_external_id: row.external_id });
    if (transitionError || !transitioned) { const p = { error: "transaction_refund_transition_failed" }; await complete("failed", 500, p); return json(p, 500); }
    const payload = { transaction_id: row.id, external_transaction_id: row.external_id, status: "refunded", amount: row.amount, currency: row.currency, sandbox };
    await db.from("sales").update({ status: "refunded", data: { refund: payload } }).eq("user_id", uid).eq("transaction_id", row.id);
    await complete("completed", 200, payload, row.id);
    return json(payload, 200);
  } catch { const p = { error: "refund_unhandled_error" }; await complete("failed", 500, p, row.id); return json(p, 500); }
});
