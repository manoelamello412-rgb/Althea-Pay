import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";

type O = Record<string, unknown>;
const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-althea-internal-secret,x-gateway-id,x-althea-gateway-id,x-althea-idempotency-key", "Access-Control-Allow-Methods": "POST,OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const obj = (v: unknown): v is O => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (v: O, s = 200) => new Response(JSON.stringify(v), { status: s, headers: H });
const nested = (v: unknown, k: string) => obj(v) ? str(v[k]) : "";
const err = (p: O, f: string) => { const e = p.error; if (typeof e === "string") return e; if (obj(e) && typeof e.message === "string") return e.message; if (Array.isArray(p.errors) && obj(p.errors[0]) && typeof p.errors[0].description === "string") return p.errors[0].description; if (typeof p.message === "string") return p.message; return f; };
const norm = (provider: string, b: O) => { const s = str(b.status ?? b.payment_status ?? b.paymentStatus).toLowerCase(); if (provider === "stripe") return ["succeeded", "requires_capture"].includes(s) ? "approved" : ["processing", "requires_action", "requires_confirmation"].includes(s) ? "pending" : ["canceled", "requires_payment_method"].includes(s) ? "declined" : "error"; if (provider === "asaas") return ["received", "confirmed", "received_in_cash"].includes(s) ? "approved" : ["pending", "awaiting_risk_analysis", "in_analysis"].includes(s) ? "pending" : ["overdue", "refunded", "deleted", "failed", "chargeback"].includes(s) ? "declined" : "error"; if (provider === "mercado_pago") return ["approved", "authorized"].includes(s) ? "approved" : ["in_process", "pending", "in_mediation"].includes(s) ? "pending" : ["rejected", "cancelled", "cancelled_by_collector"].includes(s) ? "declined" : "error"; return ["approved", "succeeded", "success", "paid", "completed", "complete", "captured"].includes(s) ? "approved" : ["pending", "processing", "in_process", "authorized", "requires_action", "created"].includes(s) ? "pending" : ["declined", "failed", "failure", "rejected", "cancelled", "canceled", "refunded", "chargeback"].includes(s) ? "declined" : "error"; };
const parse = async (r: Response): Promise<O> => { const x = await r.json().catch(() => ({})); return obj(x) ? x : {}; };
const timeout = 15_000;

function deepGet(v: unknown, path: string): unknown { let cur: unknown = v; for (const part of path.split(".").filter(Boolean)) { if (!obj(cur)) return undefined; cur = cur[part]; } return cur; }
function first(v: O, paths: string[], fallback = ""): string { for (const p of paths) { const x = deepGet(v, p); if (typeof x === "string" || typeof x === "number") return String(x); } return fallback; }
async function publicUrl(raw: string): Promise<string> { const checked = await assertPublicHttpsUrl(raw); if (!checked.ok) throw new Error(`target_not_allowed:${checked.reason}`); return checked.url; }

async function customRest(operation: string, body: O, credential: O): Promise<Response> {
  const base = str(credential.base_url); if (!base) return json({ ok: false, error: "custom_rest_base_url_missing" }, 422);
  const baseUrl = await publicUrl(base);
  const rawPath = operation === "health_check" ? str(credential.health_path) : operation === "refund" ? str(credential.refund_path) : ["payment_status", "retrieve_payment", "retrieve", "status"].includes(operation) ? str(credential.status_path) : str(credential.create_path);
  const path = rawPath || (operation === "health_check" ? "/health" : "/payments");
  const externalId = str(body.external_transaction_id ?? body.original_external_id ?? body.provider_transaction_id);
  const resolvedPath = path.replaceAll("{id}", encodeURIComponent(externalId));
  const target = new URL(resolvedPath, baseUrl).toString();
  const url = await publicUrl(target);
  const apiKey = str(credential.api_key ?? credential.access_token ?? credential.secret_key ?? credential.token);
  const authHeader = str(credential.auth_header) || "Authorization";
  const authPrefix = credential.auth_prefix === "" ? "" : (str(credential.auth_prefix) || "Bearer");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (apiKey) headers[authHeader] = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;
  const idem = str(body.idempotency_key);
  if (idem) headers["Idempotency-Key"] = idem;
  const method = operation === "health_check" || ["payment_status", "retrieve_payment", "retrieve", "status"].includes(operation) ? "GET" : "POST";
  const amount = Number(body.amount ?? 0);
  const payload: O = { amount, currency: str(body.currency || "BRL").toUpperCase(), transaction_id: externalId || undefined, payment_token: str(body.payment_token) || undefined, customer: obj(body.customer) ? body.customer : {}, metadata: obj(body.metadata) ? body.metadata : {} };
  const r = await fetch(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(timeout) });
  const p = await parse(r);
  if (!r.ok) return json({ ok: false, error: err(p, `custom_rest_http_${r.status}`), failure_code: `http_${r.status}` }, r.status >= 400 && r.status < 600 ? r.status : 502);
  const id = first(p, ["id", "transaction_id", "transactionId", "payment_id", "paymentId", "data.id", "data.transaction_id"], externalId);
  const providerStatus = first(p, ["status", "payment_status", "paymentStatus", "state", "data.status"], "");
  return json({ ok: true, id, external_id: id, status: operation === "health_check" ? "approved" : norm("custom_rest", { ...p, status: providerStatus }), provider_status: providerStatus, amount: Number(first(p, ["amount", "value", "data.amount"], String(amount))), currency: str(first(p, ["currency", "data.currency"], str(body.currency || "BRL"))).toUpperCase(), response: p });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const expected = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "", supplied = req.headers.get("x-althea-internal-secret") ?? "";
  if (!expected || expected.length !== supplied.length) return json({ ok: false, error: "forbidden" }, 403);
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i); if (diff !== 0) return json({ ok: false, error: "forbidden" }, 403);
  let b: O; try { const x = await req.json(); if (!obj(x)) return json({ ok: false, error: "invalid_json" }, 400); b = x; } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const provider = str(b.provider).toLowerCase(), operation = str(b.operation).toLowerCase(), gatewayId = str(b.gateway_id ?? req.headers.get("x-gateway-id")), environment = str(b.environment).toLowerCase() === "sandbox" ? "sandbox" : "production";
  if (!provider || !gatewayId) return json({ ok: false, error: "provider_and_gateway_required" }, 422);
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !service) return json({ ok: false, error: "server_configuration_error" }, 500);
  const db = createClient(url, service, { auth: { persistSession: false } });
  const reg = await db.from("gateway_provider_registry").select("provider_key,adapter_key,adapter_url,operational,is_active").eq("provider_key", provider).eq("is_active", true).maybeSingle();
  if (reg.error) return json({ ok: false, error: "provider_registry_lookup_failed" }, 500); if (!reg.data) return json({ ok: false, error: "provider_not_registered" }, 422);
  const gateway = await db.from("gateways").select("id,user_id,provider,environment,status").eq("id", gatewayId).maybeSingle();
  if (gateway.error || !gateway.data || String(gateway.data.provider).toLowerCase() !== provider || !["connected", "degraded"].includes(String(gateway.data.status).toLowerCase())) return json({ ok: false, error: "gateway_not_operational" }, 422);
  const cr = await db.rpc("resolve_gateway_credential_for_gateway", { p_gateway_id: gatewayId }); if (cr.error || !obj(cr.data)) return json({ ok: false, error: "provider_credential_missing" }, 422);
  const c = cr.data, credential = obj(c.credentials) ? c.credentials : c;
  if (!obj(credential)) return json({ ok: false, error: "provider_credential_invalid" }, 422);
  if (provider === "custom_rest") { if (reg.data.operational !== true) return json({ ok: false, error: "provider_adapter_not_operational" }, 422); try { return await customRest(operation, b, credential); } catch (e) { const message = e instanceof Error ? e.message : "custom_rest_adapter_error"; return json({ ok: false, error: message.startsWith("target_not_allowed") ? "target_not_allowed" : "custom_rest_adapter_error" }, 502); } }
  const apiCredential = str(c.api_key ?? credential.api_key ?? credential.access_token ?? credential.secret_key);
  const statusOps = ["payment_status", "retrieve_payment", "retrieve", "status"];
  if (!apiCredential && !statusOps.includes(operation)) return json({ ok: false, error: "provider_credential_missing" }, 422);
  try {
    if (statusOps.includes(operation)) {
      const id = str(b.external_transaction_id ?? b.original_external_id ?? b.provider_transaction_id); if (!id) return json({ ok: false, error: "external_transaction_id_required" }, 422);
      const api = provider === "stripe" ? `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}` : provider === "asaas" ? `${environment === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3"}/payments/${encodeURIComponent(id)}` : `https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`;
      const auth = provider === "stripe" ? `Basic ${btoa(`${apiCredential}:`)}` : `Bearer ${apiCredential}`;
      const r = await fetch(api, { headers: { Authorization: auth }, signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "status_lookup_failed"), failure_code: `http_${r.status}`, external_id: id }, r.status);
      return json({ ok: true, id: p.id ?? id, status: norm(provider, p), provider_status: str(p.status ?? p.payment_status), amount: provider === "stripe" ? p.amount : Number(p.transaction_amount ?? p.value ?? 0) * 100, currency: String(p.currency ?? b.currency ?? "BRL").toUpperCase() });
    }
    const amount = Number(b.amount ?? 0), currency = str(b.currency ?? "BRL").toUpperCase(), metadata = obj(b.metadata) ? b.metadata : {}, customer = obj(b.customer) ? b.customer : {}, token = str(b.payment_token), idem = str(b.idempotency_key ?? req.headers.get("x-althea-idempotency-key"));
    if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return json({ ok: false, error: "invalid_money" }, 422); if (!idem) return json({ ok: false, error: "idempotency_key_required" }, 422);
    const auth = provider === "stripe" ? `Basic ${btoa(`${apiCredential}:`)}` : `Bearer ${apiCredential}`;
    if (provider === "stripe") {
      if (!["create_payment", "payment", "refund"].includes(operation)) return json({ ok: false, error: "unsupported_operation" }, 422);
      if (operation === "refund") { const original = str(b.original_external_id); if (!original) return json({ ok: false, error: "original_external_id_required" }, 422); const form = new URLSearchParams({ payment_intent: original, amount: String(Math.round(amount)) }); const r = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idem }, body: form, signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "stripe_refund_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id, status: p.status === "succeeded" ? "approved" : "pending", amount: p.amount, currency: String(p.currency ?? currency).toUpperCase() }); }
      let pm = str(metadata.payment_method_id); if (token && !pm) { if (token.startsWith("pm_")) pm = token; else if (token.startsWith("tok_")) { const f = new URLSearchParams({ type: "card", "card[token]": token }); const r = await fetch("https://api.stripe.com/v1/payment_methods", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `${idem}:payment_method` }, body: f, signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "stripe_payment_method_failed"), failure_code: `http_${r.status}` }, r.status); pm = str(p.id); } else return json({ ok: false, error: "unsupported_stripe_payment_token" }, 422); }
      const f = new URLSearchParams({ amount: String(Math.round(amount)), currency: currency.toLowerCase(), "metadata[althea_idempotency]": idem, confirm: pm ? "true" : "false" }); if (pm) f.set("payment_method", pm); const r = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idem }, body: f, signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "stripe_payment_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id, status: norm(provider, p), provider_status: str(p.status), amount: p.amount, currency: String(p.currency ?? currency).toUpperCase() });
    }
    if (provider === "asaas") { const base = environment === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3"; if (operation === "refund") { const original = str(b.original_external_id); if (!original) return json({ ok: false, error: "original_external_id_required" }, 422); const r = await fetch(`${base}/payments/${encodeURIComponent(original)}/refund`, { method: "POST", headers: { Authorization: `Bearer ${apiCredential}`, "Content-Type": "application/json", "X-Idempotency-Key": idem }, body: JSON.stringify({ value: amount / 100 }), signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "asaas_refund_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id ?? original, status: "approved", amount: Number(p.value ?? amount / 100) * 100, currency }); } const pc = nested(customer, "provider_customer_id"); if (!pc) return json({ ok: false, error: "asaas_provider_customer_id_required" }, 422); const billing = str(metadata.billing_type) || "UNDEFINED"; const payload: O = { customer: pc, billingType: billing, value: amount / 100, dueDate: str(metadata.due_date) || new Date(Date.now() + 86400000).toISOString().slice(0, 10), description: str(metadata.description) || "ALTHEA PAY charge" }; if (token && billing === "CREDIT_CARD") payload.creditCardToken = token; const r = await fetch(`${base}/payments`, { method: "POST", headers: { Authorization: `Bearer ${apiCredential}`, "Content-Type": "application/json", "X-Idempotency-Key": idem }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "asaas_payment_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id, status: norm(provider, p), provider_status: str(p.status), amount: Number(p.value ?? amount / 100) * 100, currency }); }
    if (operation === "refund") { const original = str(b.original_external_id); if (!original) return json({ ok: false, error: "original_external_id_required" }, 422); const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(original)}/refunds`, { method: "POST", headers: { Authorization: `Bearer ${apiCredential}`, "Content-Type": "application/json", "X-Idempotency-Key": idem }, body: JSON.stringify({ amount: amount / 100 }), signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "mercado_pago_refund_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id, status: p.status === "approved" ? "approved" : "pending", amount: Number(p.amount ?? amount / 100) * 100, currency }); }
    const pm = str(metadata.payment_method_id), email = nested(customer, "email"); if (!pm || !token || !email) return json({ ok: false, error: "mercado_pago_payment_method_token_and_customer_email_required" }, 422); const installments = Math.max(1, Math.min(36, Number(metadata.installments) || 1)); const r = await fetch("https://api.mercadopago.com/v1/payments", { method: "POST", headers: { Authorization: `Bearer ${apiCredential}`, "Content-Type": "application/json", "X-Idempotency-Key": idem }, body: JSON.stringify({ transaction_amount: amount / 100, description: str(metadata.description) || "ALTHEA PAY charge", payment_method_id: pm, token, installments, payer: { email } }), signal: AbortSignal.timeout(timeout) }), p = await parse(r); if (!r.ok) return json({ ok: false, error: err(p, "mercado_pago_payment_failed"), failure_code: `http_${r.status}` }, r.status); return json({ ok: true, id: p.id, status: norm(provider, p), provider_status: str(p.status), amount: Number(p.transaction_amount ?? amount / 100) * 100, currency });
  } catch (e) { return json({ ok: false, error: "provider_adapter_error", detail: e instanceof Error ? e.message : "unknown_error" }, 502); }
});
