import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getGatewayProvider } from "../../../lib/gateway-registry.ts";

type Failure = "technical" | "timeout" | "unavailable" | "declined" | "fraud" | "pending" | "validation" | "unknown";
type GatewayStatus = "approved" | "declined" | "pending" | "error";
type Gateway = { id: string; user_id: string; provider: string; display_name: string; environment: "sandbox" | "production"; status: string; capabilities: Record<string, unknown>; circuit_id: string; credential_id: string | null };
type Route = { id: string; gateway_id: string; priority: number; enabled: boolean; fallback_enabled: boolean; conditions: Record<string, unknown> | null };
type Attempt = { gateway_id: string; provider: string; attempt: number; outcome: string; failure_class: Failure | null; reason: string; external_transaction_id?: string | null; latency_ms: number };

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key, idempotency-key", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const TIMEOUT_MS = 2800, BUDGET_MS = 7200, SAFETY_MARGIN_MS = 250, MAX_GATEWAYS = 2, MAX_PROVIDER_ATTEMPTS = 2;
const CIRCUIT_FAILURE_THRESHOLD = 5, CIRCUIT_COOLDOWN_SECONDS = 60, CIRCUIT_PROBE_SECONDS = 10;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeProvider = (v: unknown) => String(v ?? "").trim().toLowerCase();
const isRetryable = (f: Failure | null | undefined) => f === "technical" || f === "timeout" || f === "unavailable";

function classify(status: number, payload: unknown): Failure {
  const value = isRecord(payload) ? String(payload.failure_class ?? payload.failure_code ?? payload.code ?? payload.error_code ?? payload.error ?? "").toLowerCase() : "";
  if (value.includes("fraud") || value.includes("risk")) return "fraud";
  if (value.includes("pending") || value.includes("processing")) return "pending";
  if (value.includes("declin") || value.includes("insufficient") || value.includes("invalid_card")) return "declined";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429 || status >= 500) return "unavailable";
  if (status >= 400) return "declined";
  return "technical";
}

function normalizeStatus(payload: Record<string, unknown>): GatewayStatus {
  const status = String(payload.status ?? payload.payment_status ?? "").trim().toLowerCase();
  if (payload.approved === true || ["approved", "succeeded", "success", "paid", "received", "confirmed", "authorized", "captured"].includes(status)) return "approved";
  if (["pending", "processing", "in_process", "in_review"].includes(status)) return "pending";
  if (["declined", "failed", "rejected", "canceled", "cancelled"].includes(status)) return "declined";
  return "error";
}

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request, url: string, anonKey: string) {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user;
}

async function callAdapter(gateway: Gateway, payload: Record<string, unknown>, idempotencyKey: string, credential: Record<string, unknown> | null, internalSecret: string, timeoutMs: number) {
  const provider = normalizeProvider(gateway.provider);
  const envKey = `GATEWAY_ADAPTER_URL_${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
  const base = Deno.env.get("GATEWAY_ADAPTER_BASE_URL")?.replace(/\/$/, "");
  const configured = Deno.env.get(envKey) ?? (base ? `${base}/adapters/${encodeURIComponent(provider)}` : "");
  if (!configured) return { ok: false, status: "error" as GatewayStatus, failure: "unavailable" as Failure, reason: "adapter_url_not_configured", payload: {}, latencyMs: 0 };
  let adapterUrl: string;
  try { const parsed = new URL(configured); if (parsed.protocol !== "https:") throw new Error("adapter_https_required"); adapterUrl = parsed.toString(); } catch (error) { return { ok: false, status: "error" as GatewayStatus, failure: "validation" as Failure, reason: error instanceof Error ? error.message : "invalid_adapter_url", payload: {}, latencyMs: 0 }; }
  let last = { ok: false, status: "error" as GatewayStatus, failure: "technical" as Failure, reason: "adapter_request_failed", payload: {} as Record<string, unknown>, latencyMs: 0 };
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
    const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(TIMEOUT_MS, timeoutMs)));
    try {
      const response = await fetch(adapterUrl, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "X-Althea-Internal-Secret": internalSecret, "X-Althea-Gateway-Id": gateway.id, "X-Althea-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ ...payload, provider, environment: gateway.environment, gateway_id: gateway.id, idempotency_key: idempotencyKey, credential }) });
      const raw = await response.json().catch(() => ({})); const responsePayload = isRecord(raw) ? raw : {}; const latencyMs = Date.now() - started; const status = normalizeStatus(responsePayload);
      if (!response.ok) last = { ok: false, status, failure: classify(response.status, responsePayload), reason: String(responsePayload.error ?? `adapter_http_${response.status}`), payload: responsePayload, latencyMs };
      else if (status === "approved") return { ok: true, status, failure: null as Failure | null, reason: "approved", payload: responsePayload, latencyMs };
      else if (status === "pending") return { ok: false, status, failure: "pending" as Failure, reason: "gateway_pending", payload: responsePayload, latencyMs };
      else if (status === "declined") return { ok: false, status, failure: "declined" as Failure, reason: String(responsePayload.error ?? responsePayload.failure_code ?? "gateway_declined"), payload: responsePayload, latencyMs };
      else last = { ok: false, status, failure: classify(response.status, responsePayload), reason: String(responsePayload.error ?? "gateway_error"), payload: responsePayload, latencyMs };
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === "AbortError";
      last = { ok: false, status: "error", failure: timeout ? "timeout" : "technical", reason: timeout ? "adapter_timeout" : error instanceof Error ? error.message : "adapter_request_failed", payload: {}, latencyMs: Date.now() - started };
    } finally { clearTimeout(timer); }
    if (!isRetryable(last.failure) || attempt === MAX_PROVIDER_ATTEMPTS) break;
    await sleep(100 * 2 ** (attempt - 1));
  }
  return last;
}

async function resolveCredential(db: ReturnType<typeof createClient>, gatewayId: string) {
  const { data, error } = await db.rpc("resolve_gateway_credential_for_gateway", { p_gateway_id: gatewayId });
  if (error) throw new Error(`gateway_credential_resolution_failed:${error.message}`);
  return isRecord(data) ? data : null;
}

async function recordHealth(db: ReturnType<typeof createClient>, gateway: Gateway, success: boolean, latencyMs: number) {
  await db.rpc("record_gateway_health", { p_gateway_id: gateway.circuit_id, p_gateway_name: gateway.provider, p_success: success, p_latency_ms: Math.max(0, Math.round(latencyMs)) }).catch(() => undefined);
}

async function acquireCircuit(db: ReturnType<typeof createClient>, userId: string, gateway: Gateway) {
  const { data, error } = await db.rpc("acquire_gateway_circuit", { p_user_id: userId, p_gateway_id: gateway.circuit_id, p_gateway_name: gateway.provider, p_failure_threshold: CIRCUIT_FAILURE_THRESHOLD, p_cooldown_seconds: CIRCUIT_COOLDOWN_SECONDS, p_probe_lease_seconds: CIRCUIT_PROBE_SECONDS });
  if (error) throw new Error(`gateway_circuit_acquire_failed:${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? row : { allowed: false, circuit_state: "open" };
}

async function recordCircuit(db: ReturnType<typeof createClient>, userId: string, gateway: Gateway, failure: Failure | null) {
  if (isRetryable(failure)) await db.rpc("record_gateway_circuit_failure", { p_user_id: userId, p_gateway_id: gateway.circuit_id, p_gateway_name: gateway.provider, p_failure_class: failure, p_failure_threshold: CIRCUIT_FAILURE_THRESHOLD }).catch(() => undefined);
  else await db.rpc("record_gateway_circuit_success", { p_user_id: userId, p_gateway_id: gateway.circuit_id, p_gateway_name: gateway.provider }).catch(() => undefined);
}

async function createTransaction(db: ReturnType<typeof createClient>, input: Record<string, unknown>) {
  const { data, error } = await db.from("gateway_transactions").insert(input).select().single();
  if (error || !data) throw new Error(`transaction_create_failed:${error?.message ?? "empty_result"}`);
  return data as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET");
  if (!url || !anonKey || !serviceKey || !internalSecret) return json({ error: "server_configuration_error" }, 500);
  const user = await authenticate(req, url, anonKey); if (!user) return json({ error: "unauthorized" }, 401);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { const parsed = await req.json(); if (!isRecord(parsed)) return json({ error: "invalid_json" }, 400); body = parsed; } catch { return json({ error: "invalid_json" }, 400); }
  const funnelId = String(body.funnel_id ?? "").trim(), operation = String(body.operation ?? "create_payment").trim().toLowerCase(), amount = Number(body.amount ?? 0), currency = String(body.currency ?? "BRL").trim().toUpperCase(), productId = body.product_id ? String(body.product_id) : null, originalId = String(body.original_transaction_id ?? body.transaction_id ?? "").trim(), key = String(body.idempotency_key ?? req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key") ?? "").trim(), metadata = isRecord(body.metadata) ? body.metadata : {}, customer = isRecord(body.customer) ? body.customer : {};
  if (!funnelId || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !key) return json({ error: "funnel_id_amount_currency_and_idempotency_key_required" }, 400);
  if (key.length > 200) return json({ error: "idempotency_key_too_long" }, 400);
  if (["card_data", "pan", "card_number", "cardNumber", "cvv", "cvc"].some((name) => body[name] !== undefined)) return json({ error: "raw_card_data_forbidden" }, 400);
  if (operation === "refund" && !originalId) return json({ error: "original_transaction_id_required" }, 422);

  const requestDigest = await digest({ funnelId, operation, amount, currency, productId, originalId, metadata, customer });
  const { data: reservation, error: reservationError } = await db.rpc("reserve_idempotency_key", { p_user_id: user.id, p_scope: `gateway-orchestrator:${funnelId}:${operation}:${originalId || "new"}`, p_idempotency_key: key, p_request_digest: requestDigest, p_ttl: "24 hours" });
  if (reservationError) return json({ error: "idempotency_reservation_failed" }, 500);
  const lease = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!isRecord(lease)) return json({ error: "idempotency_invalid_response" }, 500);
  if (lease.acquired !== true) { if (lease.response_payload) return json(lease.response_payload, Number(lease.response_code ?? 200)); return json({ error: "request_in_progress", idempotency_key: key }, 409); }
  const reservationId = String(lease.id ?? ""), leaseToken = lease.lease_token ? String(lease.lease_token) : null; let completed = false;
  const complete = async (status: string, code: number, payload: unknown, resourceType: string | null = null, resourceId: string | null = null) => { if (completed || !reservationId) return; const { error } = await db.rpc("complete_idempotency_key", { p_id: reservationId, p_status: status, p_response_code: code, p_response_payload: payload, p_resource_type: resourceType, p_resource_id: resourceId, p_lease_token: leaseToken }); if (!error) completed = true; };

  try {
    if (operation === "refund") {
      const { data: original, error: originalError } = await db.from("gateway_transactions").select("id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,metadata,customer").eq("id", originalId).eq("user_id", user.id).maybeSingle();
      if (originalError || !original) return await (complete("failed", 404, { error: "original_transaction_not_found" }), json({ error: "original_transaction_not_found" }, 404));
      if (String(original.funnel_id) !== funnelId) return await (complete("failed", 422, { error: "transaction_funnel_mismatch" }), json({ error: "transaction_funnel_mismatch" }, 422));
      if (String(original.status) !== "approved") return await (complete("failed", 409, { error: "transaction_not_refundable", status: original.status }), json({ error: "transaction_not_refundable", status: original.status }, 409));
      if (!original.external_id) return await (complete("failed", 409, { error: "original_external_id_missing" }), json({ error: "original_external_id_missing" }, 409));
      const { data: gateway, error: gatewayError } = await db.from("gateways").select("id,user_id,provider,display_name,environment,status,capabilities,circuit_id,credential_id").eq("id", original.gateway_id).eq("user_id", user.id).maybeSingle();
      if (gatewayError || !gateway) return await (complete("failed", 409, { error: "gateway_not_found" }), json({ error: "gateway_not_found" }, 409));
      if (!getGatewayProvider(String(gateway.provider))) return await (complete("failed", 422, { error: "unsupported_gateway_provider" }), json({ error: "unsupported_gateway_provider" }, 422));
      const refundAmount = body.refund_amount === undefined ? Number(original.amount) : Number(body.refund_amount);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > Number(original.amount)) return await (complete("failed", 422, { error: "invalid_refund_amount" }), json({ error: "invalid_refund_amount" }, 422));
      const { data: existingRefund } = await db.from("gateway_refunds").select("*").eq("user_id", user.id).eq("idempotency_key", key).maybeSingle();
      if (existingRefund) return await (complete("completed", 200, { refund: existingRefund }, "gateway_refund", String(existingRefund.id)), json({ refund: existingRefund }, 200));
      const sandbox = gateway.environment === "sandbox";
      const credential = sandbox ? null : await resolveCredential(db, String(gateway.id));
      if (!sandbox && !credential) return await (complete("failed", 409, { error: "gateway_credential_not_bound" }), json({ error: "gateway_credential_not_bound" }, 409));
      if (!sandbox && (await acquireCircuit(db, user.id, gateway as Gateway)).allowed !== true) return await (complete("failed", 503, { error: "gateway_circuit_open" }), json({ error: "gateway_circuit_open" }, 503));
      const { data: ledger, error: ledgerError } = await db.from("gateway_refunds").insert({ user_id: user.id, transaction_id: original.id, gateway_id: gateway.id, idempotency_key: key, amount: refundAmount, currency: original.currency, status: "pending", metadata: { source: "gateway-orchestrator" } }).select().single();
      if (ledgerError || !ledger) return await (complete("failed", 500, { error: "refund_ledger_create_failed" }), json({ error: "refund_ledger_create_failed" }, 500));
      const result = sandbox ? { ok: true, status: "approved" as GatewayStatus, failure: null as Failure | null, reason: "sandbox_refund_approved", payload: { id: `sbx_refund_${original.external_id}`, status: "approved" }, latencyMs: 1 } : await callAdapter(gateway as Gateway, { operation: "refund", amount: refundAmount, currency: original.currency, original_transaction_id: original.id, original_external_id: original.external_id, customer: original.customer ?? {}, metadata }, `${key}:refund:${original.id}`, credential, internalSecret, TIMEOUT_MS);
      await recordHealth(db, gateway as Gateway, result.failure === null || result.failure === "declined" || result.failure === "pending", result.latencyMs); if (!sandbox) await recordCircuit(db, user.id, gateway as Gateway, result.failure);
      const externalRefundId = result.payload.id ? String(result.payload.id) : result.payload.refund_id ? String(result.payload.refund_id) : null;
      if (!result.ok) { await db.from("gateway_refunds").update({ status: result.failure === "pending" ? "pending" : "failed", failure_code: result.failure, failure_message: result.reason, updated_at: new Date().toISOString() }).eq("id", ledger.id); const code = result.failure === "pending" ? 202 : result.failure === "declined" ? 402 : 503; const response = { error: "refund_failed", failure_class: result.failure ?? "unknown", reason: result.reason, refund_id: ledger.id }; return await (complete(result.failure === "pending" ? "completed" : "failed", code, response, "gateway_refund", ledger.id), json(response, code)); }
      const { data: transitioned, error: transitionError } = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: original.id, p_user_id: user.id, p_next_status: refundAmount === Number(original.amount) ? "refunded" : "approved", p_failure_code: null, p_external_id: String(original.external_id) });
      if (transitionError) return await (complete("failed", 500, { error: "refund_state_transition_failed" }), json({ error: "refund_state_transition_failed" }, 500));
      await db.from("gateway_refunds").update({ status: "approved", external_refund_id: externalRefundId, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ledger.id);
      if (refundAmount === Number(original.amount)) await db.from("sales").update({ status: "refunded" }).eq("user_id", user.id).eq("transaction_id", original.id);
      const response = { refund: { ...ledger, status: "approved", external_refund_id: externalRefundId }, transaction: transitioned, sandbox }; return await (complete("completed", 200, response, "gateway_refund", ledger.id), json(response, 200));
    }

    const { data: funnel } = await db.from("funnels").select("id").eq("id", funnelId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
    if (!funnel) return await (complete("failed", 404, { error: "funnel_not_found" }), json({ error: "funnel_not_found" }, 404));
    const { data: routes, error: routesError } = await db.from("gateway_routes").select("id,gateway_id,priority,enabled,fallback_enabled,conditions").eq("user_id", user.id).eq("funnel_id", funnelId).eq("enabled", true).order("priority", { ascending: true });
    if (routesError) return await (complete("failed", 500, { error: "route_lookup_failed" }), json({ error: "route_lookup_failed" }, 500));
    if (!routes?.length) return await (complete("failed", 409, { error: "no_active_gateway_route" }), json({ error: "no_active_gateway_route" }, 409));
    const routeRows = routes as unknown as Route[], gatewayIds = routeRows.map((route) => route.gateway_id);
    const { data: gateways, error: gatewaysError } = await db.from("gateways").select("id,user_id,provider,display_name,environment,status,capabilities,circuit_id,credential_id").eq("user_id", user.id).in("id", gatewayIds);
    if (gatewaysError) return await (complete("failed", 500, { error: "gateway_lookup_failed" }), json({ error: "gateway_lookup_failed" }, 500));
    const gatewayMap = new Map<string, Gateway>((gateways ?? []).map((gateway) => [String(gateway.id), gateway as Gateway]));
    const candidates = routeRows.map((route) => ({ route, gateway: gatewayMap.get(route.gateway_id) })).filter((candidate): candidate is { route: Route; gateway: Gateway } => Boolean(candidate.gateway)).filter(({ gateway }) => gateway.status !== "disabled" && Boolean(getGatewayProvider(gateway.provider))).slice(0, MAX_GATEWAYS);
    if (!candidates.length) return await (complete("failed", 409, { error: "no_supported_gateway_route" }), json({ error: "no_supported_gateway_route" }, 409));

    const attempts: Attempt[] = []; const deadline = Date.now() + BUDGET_MS; let selectedTransaction: Record<string, unknown> | null = null; let lastFailure: Failure = "unknown";
    for (const candidate of candidates) {
      if (Date.now() + SAFETY_MARGIN_MS >= deadline) { lastFailure = "timeout"; break; }
      const gateway = candidate.gateway, provider = normalizeProvider(gateway.provider), sandbox = gateway.environment === "sandbox";
      if (!sandbox && (await acquireCircuit(db, user.id, gateway)).allowed !== true) { attempts.push({ gateway_id: gateway.id, provider, attempt: attempts.length + 1, outcome: "circuit_open", failure_class: "unavailable", reason: "gateway_circuit_open", latency_ms: 0 }); lastFailure = "unavailable"; continue; }
      const credential = sandbox ? null : await resolveCredential(db, gateway.id);
      if (!sandbox && !credential) { attempts.push({ gateway_id: gateway.id, provider, attempt: attempts.length + 1, outcome: "credential_missing", failure_class: "unavailable", reason: "gateway_credential_not_bound", latency_ms: 0 }); lastFailure = "unavailable"; continue; }
      const scenario = String(metadata.simulate_failure ?? "").toLowerCase();
      const result = sandbox ? scenario === "technical" ? { ok: false, status: "error" as GatewayStatus, failure: "technical" as Failure, reason: "simulated_technical_failure", payload: {}, latencyMs: 1 } : scenario === "timeout" ? { ok: false, status: "error" as GatewayStatus, failure: "timeout" as Failure, reason: "simulated_timeout", payload: {}, latencyMs: TIMEOUT_MS } : scenario === "card_decline" ? { ok: false, status: "declined" as GatewayStatus, failure: "declined" as Failure, reason: "simulated_card_decline", payload: { status: "declined" }, latencyMs: 1 } : scenario === "pending" ? { ok: false, status: "pending" as GatewayStatus, failure: "pending" as Failure, reason: "sandbox_pending", payload: { status: "pending", id: `sbx_${crypto.randomUUID()}` }, latencyMs: 1 } : { ok: true, status: "approved" as GatewayStatus, failure: null as Failure | null, reason: "sandbox_approved", payload: { status: "approved", id: `sbx_${crypto.randomUUID()}` }, latencyMs: 1 } : await callAdapter(gateway, { operation: "create_payment", amount, currency, product_id: productId, funnel_id: funnelId, customer, payment_token: body.payment_token ?? body.vault_token ?? null, metadata }, `${key}:${gateway.id}`, credential, internalSecret, Math.min(TIMEOUT_MS, Math.max(250, deadline - Date.now() - SAFETY_MARGIN_MS));
      await recordHealth(db, gateway, result.failure === null || result.failure === "declined" || result.failure === "pending", result.latencyMs); if (!sandbox) await recordCircuit(db, user.id, gateway, result.failure);
      const externalId = result.payload.id ? String(result.payload.id) : result.payload.transaction_id ? String(result.payload.transaction_id) : null;
      attempts.push({ gateway_id: gateway.id, provider, attempt: attempts.length + 1, outcome: result.ok ? "approved" : "failed", failure_class: result.failure, reason: result.reason, external_transaction_id: externalId, latency_ms: result.latencyMs });
      await db.from("gateway_payment_attempts").insert({ user_id: user.id, sale_id: null, product_id: productId, gateway_id: gateway.id, gateway_name: provider, routing_rule_id: candidate.route.id, idempotency_key: `${key}:${gateway.id}`, attempt_order: attempts.length, status: result.ok ? "approved" : result.failure === "declined" ? "declined" : result.failure === "pending" ? "pending" : "error", failure_class: result.failure, external_transaction_id: externalId, error_message: result.ok ? null : result.reason, completed_at: new Date().toISOString() });
      if (result.ok || result.failure === "pending") {
        const transaction = await createTransaction(db, { user_id: user.id, funnel_id: funnelId, product_id: productId, gateway_id: gateway.id, external_id: externalId ?? `internal_${crypto.randomUUID()}`, idempotency_key: key, amount, currency, status: "created", customer, metadata: { ...metadata, provider, environment: gateway.environment }, attempt_count: attempts.length, completed_at: null, routing_metadata: { route_id: candidate.route.id, provider, attempts } });
        const nextStatus = result.failure === "pending" ? "pending" : "approved";
        const { data: transitioned, error: transitionError } = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: String(transaction.id), p_user_id: user.id, p_next_status: nextStatus, p_failure_code: result.failure, p_external_id: externalId });
        if (transitionError) return await (complete("failed", 500, { error: "transaction_state_transition_failed" }, "gateway_transaction", String(transaction.id)), json({ error: "transaction_state_transition_failed", transaction_id: transaction.id }, 500));
        selectedTransaction = transitioned as Record<string, unknown>; break;
      }
      lastFailure = result.failure ?? "unknown"; if (!isRetryable(lastFailure) || candidate.route.fallback_enabled === false) break;
    }

    await db.from("transaction_routing_logs").insert({ user_id: user.id, amount, currency, card_brand: String(metadata.card_brand ?? "unknown"), gateways_attempted: attempts, final_gateway: selectedTransaction?.gateway_id ? String(selectedTransaction.gateway_id) : null, status: selectedTransaction ? String(selectedTransaction.status) : "failed", failure_class: selectedTransaction ? null : lastFailure, created_at: new Date().toISOString(), completed_at: new Date().toISOString(), idempotency_key: key });
    if (!selectedTransaction) { const code = lastFailure === "declined" || lastFailure === "fraud" ? 402 : lastFailure === "timeout" ? 504 : 503; const response = { error: "payment_failed", failure_class: lastFailure, attempts, fallback_used: attempts.length > 1 }; return await (complete("failed", code, response), json(response, code)); }
    const response = { transaction: selectedTransaction, attempts, fallback_used: attempts.length > 1, sandbox: gatewayMap.get(String(selectedTransaction.gateway_id))?.environment === "sandbox" };
    return await (complete("completed", 200, response, "gateway_transaction", String(selectedTransaction.id)), json(response, 200));
  } catch (error) {
    const response = { error: "orchestrator_unhandled_error", detail: error instanceof Error ? error.message : "unknown_error" }; await complete("failed", 500, response); return json(response, 500);
  } finally {
    if (!completed && reservationId) await db.rpc("complete_idempotency_key", { p_id: reservationId, p_status: "failed", p_response_code: 500, p_response_payload: { error: "idempotency_aborted" }, p_resource_type: null, p_resource_id: null, p_lease_token: leaseToken }).catch(() => undefined);
  }
});
