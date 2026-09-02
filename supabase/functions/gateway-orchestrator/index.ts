import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Failure = "technical" | "timeout" | "unavailable" | "declined" | "fraud" | "pending" | "unknown";
type Gateway = { id: string; name: string; provider: string | null; type: string | null; environment: string | null; env: string | null };
type Route = { id: string; gateway_id: string; priority: number; enabled: boolean; fallback_enabled: boolean; conditions: Record<string, unknown> | null };
type RoutingAttempt = { gateway_id: string; provider: string; attempt: number; outcome: string; failure_class: Failure | null; reason: string; external_transaction_id?: string | null; success_rate?: number | null; ai_score?: number; latency_ms?: number };
type RoutingMetric = { attempts: number; approvals: number; weightedApprovals: number; weightedAttempts: number; brandAttempts: number; brandApprovals: number; latencyMs: number[] };

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key, idempotency-key", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const ATTEMPT_TIMEOUT_MS = 3900;
const ROUTING_WINDOW_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function canFailover(failure: Failure): boolean { return failure === "technical" || failure === "timeout" || failure === "unavailable"; }
function classifyFailure(status: number, payload: unknown, timeout = false): Failure {
  if (timeout) return "timeout";
  const value = isRecord(payload) ? String(payload.failure_class ?? payload.code ?? payload.error_code ?? payload.error ?? "").toLowerCase() : "";
  if (value.includes("fraud") || value.includes("risk")) return "fraud";
  if (value.includes("pending") || value.includes("processing")) return "pending";
  if (value.includes("declin") || value.includes("insufficient") || value.includes("invalid_card")) return "declined";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429 || status >= 500) return "unavailable";
  if (status >= 400) return "declined";
  return "technical";
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((part) => part.toString(16).padStart(2, "0")).join("");
}
function gatewayProvider(gateway: Gateway | undefined): string { return String(gateway?.provider ?? gateway?.type ?? gateway?.name ?? "unknown").trim().toLowerCase(); }
function requestedCardBrand(body: Record<string, unknown>): string {
  const direct = body.card_brand;
  const metadata = isRecord(body.metadata) ? body.metadata.card_brand : undefined;
  return String(direct ?? metadata ?? "unknown").trim().toLowerCase();
}
function buildRoutingMetrics(logs: Array<Record<string, unknown>>, brand: string): Map<string, RoutingMetric> {
  const now = Date.now();
  const metrics = new Map<string, RoutingMetric>();
  for (const log of logs) {
    const createdAt = Date.parse(String(log.created_at ?? ""));
    const age = Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : ROUTING_WINDOW_MS;
    const weight = Math.max(0.15, 1 - age / ROUTING_WINDOW_MS);
    const logBrand = String(log.card_brand ?? "").toLowerCase();
    const rawAttempts = Array.isArray(log.gateways_attempted) ? log.gateways_attempted : [];
    for (const raw of rawAttempts) {
      if (!isRecord(raw)) continue;
      const gatewayId = String(raw.gateway_id ?? "");
      if (!gatewayId) continue;
      const metric = metrics.get(gatewayId) ?? { attempts: 0, approvals: 0, weightedApprovals: 0, weightedAttempts: 0, brandAttempts: 0, brandApprovals: 0, latencyMs: [] };
      const approved = String(raw.outcome ?? "").toLowerCase() === "approved";
      metric.attempts += 1;
      metric.weightedAttempts += weight;
      if (approved) { metric.approvals += 1; metric.weightedApprovals += weight; }
      if (brand !== "unknown" && logBrand === brand) { metric.brandAttempts += 1; if (approved) metric.brandApprovals += 1; }
      const latency = Number(raw.latency_ms ?? 0);
      if (Number.isFinite(latency) && latency > 0) metric.latencyMs.push(latency);
      metrics.set(gatewayId, metric);
    }
  }
  return metrics;
}
function routingScore(metric: RoutingMetric, brand: string): number {
  if (metric.weightedAttempts <= 0) return 0;
  const globalRate = metric.weightedApprovals / metric.weightedAttempts;
  const brandRate = metric.brandAttempts > 0 ? metric.brandApprovals / metric.brandAttempts : globalRate;
  const brandConfidence = Math.min(1, metric.brandAttempts / 10);
  const volumeConfidence = Math.min(1, metric.weightedAttempts / 20);
  const averageLatency = metric.latencyMs.length ? metric.latencyMs.reduce((sum, value) => sum + value, 0) / metric.latencyMs.length : 0;
  const latencyScore = averageLatency <= 500 ? 1 : averageLatency >= 3000 ? 0 : 1 - ((averageLatency - 500) / 2500);
  const conversion = brandRate * (0.65 + brandConfidence * 0.35) + globalRate * (0.35 - brandConfidence * 0.35);
  const brandBonus = brand !== "unknown" ? brandConfidence * 5 : 0;
  return Number((conversion * 70 + latencyScore * 20 + volumeConfidence * 10 + brandBonus).toFixed(2));
}
async function callAdapter(provider: string, gatewayId: string, payload: Record<string, unknown>, key: string): Promise<{ ok: boolean; failure?: Failure; reason: string; payload?: Record<string, unknown>; latencyMs: number }> {
  const envName = `GATEWAY_ADAPTER_URL_${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
  const baseUrl = Deno.env.get("GATEWAY_ADAPTER_BASE_URL")?.replace(/\/$/, "");
  const url = Deno.env.get(envName) ?? (baseUrl ? `${baseUrl}/adapters/${encodeURIComponent(provider)}` : "");
  if (!url) return { ok: false, failure: "unavailable", reason: "adapter_url_not_configured", latencyMs: 0 };
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "X-Althea-Gateway-Id": gatewayId, "X-Althea-Idempotency-Key": key }, body: JSON.stringify({ ...payload, idempotency_key: key }) });
    let body: Record<string, unknown> = {};
    try { const parsed: unknown = await response.json(); if (isRecord(parsed)) body = parsed; } catch {}
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, failure: classifyFailure(response.status, body), reason: String(body.error ?? `adapter_http_${response.status}`), payload: body, latencyMs };
    const status = String(body.status ?? "").toLowerCase();
    if (body.approved === true || status === "approved" || status === "success") return { ok: true, reason: "approved", payload: body, latencyMs };
    if (status === "pending" || status === "processing") return { ok: false, failure: "pending", reason: "gateway_pending", payload: body, latencyMs };
    return { ok: false, failure: classifyFailure(response.status, body), reason: String(body.error ?? "gateway_declined"), payload: body, latencyMs };
  } catch (cause) {
    const timeout = cause instanceof DOMException && cause.name === "AbortError";
    return { ok: false, failure: timeout ? "timeout" : "technical", reason: timeout ? "adapter_timeout" : cause instanceof Error ? cause.message : "adapter_request_failed", latencyMs: Date.now() - started };
  } finally { clearTimeout(timer); }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !internalSecret) return json({ error: "server_configuration_error" }, 500);
  const authorization = request.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { const parsed: unknown = await request.json(); if (!isRecord(parsed)) return json({ error: "invalid_json" }, 400); body = parsed; } catch { return json({ error: "invalid_json" }, 400); }

  const userId = authData.user.id;
  const funnelId = String(body.funnel_id ?? "");
  const amount = Number(body.amount ?? 0);
  const currency = String(body.currency ?? "BRL").toUpperCase();
  const operation = String(body.operation ?? "create_payment");
  const productId = body.product_id ? String(body.product_id) : null;
  const idempotencyKey = String(body.idempotency_key ?? request.headers.get("x-idempotency-key") ?? request.headers.get("idempotency-key") ?? "");
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const customer = isRecord(body.customer) ? body.customer : {};
  const brand = requestedCardBrand(body);
  if (!funnelId || !Number.isFinite(amount) || amount <= 0 || !idempotencyKey) return json({ error: "funnel_id_positive_amount_and_idempotency_key_required" }, 400);
  if (idempotencyKey.length > 200) return json({ error: "idempotency_key_too_long" }, 400);
  if (body.card_data !== undefined || body.pan !== undefined || body.card_number !== undefined || body.cardNumber !== undefined || body.cvv !== undefined || body.cvc !== undefined) return json({ error: "raw_card_data_forbidden", message: "Use a network token or Althea vault reference." }, 400);

  const requestDigest = await digest({ funnelId, amount, currency, operation, productId, metadata, customer, brand });
  const { data: reservation, error: reservationError } = await adminClient.rpc("reserve_idempotency_key", { p_user_id: userId, p_scope: `gateway-orchestrator:${funnelId}:${operation}`, p_idempotency_key: idempotencyKey, p_request_digest: requestDigest, p_ttl: "24 hours" });
  if (reservationError) return json({ error: "idempotency_reservation_failed", detail: reservationError.message }, 500);
  const reservationRow = Array.isArray(reservation) ? reservation[0] as Record<string, unknown> | undefined : undefined;
  if (!reservationRow?.acquired) { if (reservationRow?.response_payload) return json(reservationRow.response_payload, Number(reservationRow.response_code ?? 200)); return json({ error: "request_in_progress", idempotency_key: idempotencyKey }, 409); }
  const reservationId = String(reservationRow.id ?? "");
  const complete = async (status: string, code: number, payload: unknown, resourceType: string | null = null, resourceId: string | null = null): Promise<void> => { if (reservationId) await adminClient.rpc("complete_idempotency_key", { p_id: reservationId, p_status: status, p_response_code: code, p_response_payload: payload, p_resource_type: resourceType, p_resource_id: resourceId }); };

  try {
    const riskController = new AbortController();
    const riskTimer = setTimeout(() => riskController.abort(), 1100);
    let risk: Record<string, unknown> = {};
    try {
      const riskResponse = await fetch(`${supabaseUrl}/functions/v1/risk-engine`, { method: "POST", signal: riskController.signal, headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret }, body: JSON.stringify({ user_id: userId, funnel_id: funnelId, amount, currency, product_id: productId, customer, metadata, ip: body.ip ?? null, device_id: body.device_id ?? null, card_fingerprint: body.card_fingerprint ?? null, idempotency_key: idempotencyKey }) });
      const parsed: unknown = await riskResponse.json().catch(() => ({}));
      if (isRecord(parsed)) risk = parsed;
      if (!riskResponse.ok) throw new Error(`risk_engine_http_${riskResponse.status}`);
    } catch (cause) { const payload = { error: "risk_engine_unavailable", detail: cause instanceof Error ? cause.message : "unknown_error" }; await complete("failed", 503, payload); return json(payload, 503); } finally { clearTimeout(riskTimer); }
    if (String(risk.decision) === "blocked" || String(risk.risk_level) === "critical") { const payload = { error: "payment_blocked_by_risk_engine", decision: "blocked", risk_score: risk.risk_score ?? null, risk_level: risk.risk_level ?? "critical", reason_codes: risk.reason_codes ?? [] }; await complete("failed", 403, payload); return json(payload, 403); }

    const { data: funnel, error: funnelError } = await userClient.from("funnels").select("id").eq("id", funnelId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (funnelError) { const payload = { error: "funnel_lookup_failed", detail: funnelError.message }; await complete("failed", 500, payload); return json(payload, 500); }
    if (!funnel) { const payload = { error: "funnel_not_found" }; await complete("failed", 404, payload); return json(payload, 404); }
    const { data: routes, error: routeError } = await userClient.from("gateway_routes").select("*").eq("user_id", userId).eq("funnel_id", funnelId).eq("enabled", true).order("priority", { ascending: true });
    if (routeError) { const payload = { error: "route_lookup_failed", detail: routeError.message }; await complete("failed", 500, payload); return json(payload, 500); }
    if (!routes?.length) { const payload = { error: "no_active_gateway_route" }; await complete("failed", 409, payload); return json(payload, 409); }

    const routeRows = routes as unknown as Route[];
    const gatewayIds = routeRows.map((route) => route.gateway_id);
    const { data: gateways } = await userClient.from("gateways").select("id,name,provider,type,environment,env").eq("user_id", userId).in("id", gatewayIds);
    const gatewayMap = new Map<string, Gateway>((gateways ?? []).map((gateway) => [String(gateway.id), gateway as Gateway]));
    const { data: credentials } = await adminClient.from("user_gateway_credentials").select("gateway_name,is_active,priority_order").eq("user_id", userId).eq("is_active", true).order("priority_order", { ascending: true });
    const credentialPriority = new Map<string, number>((credentials ?? []).map((credential) => [String(credential.gateway_name).toLowerCase(), Number(credential.priority_order)]));
    const { data: routingLogs } = await adminClient.from("transaction_routing_logs").select("gateways_attempted,created_at,card_brand").eq("user_id", userId).gte("created_at", new Date(Date.now() - ROUTING_WINDOW_MS).toISOString()).order("created_at", { ascending: false }).limit(1000);
    const metrics = buildRoutingMetrics((routingLogs ?? []) as Array<Record<string, unknown>>, brand);

    const scored = routeRows.map((route) => {
      const gateway = gatewayMap.get(route.gateway_id);
      const provider = gatewayProvider(gateway);
      const metric = metrics.get(route.gateway_id) ?? { attempts: 0, approvals: 0, weightedApprovals: 0, weightedAttempts: 0, brandAttempts: 0, brandApprovals: 0, latencyMs: [] };
      const routeBrand = String(route.conditions?.card_brand ?? "").toLowerCase();
      const score = routingScore(metric, brand) + (routeBrand && routeBrand !== brand ? -100 : 0);
      return { route, gateway, provider, metric, score, configuredPriority: credentialPriority.get(provider) ?? route.priority };
    }).sort((a, b) => b.score - a.score || a.configuredPriority - b.configuredPriority || a.route.priority - b.route.priority);

    const attempts: RoutingAttempt[] = [];
    let transaction: Record<string, unknown> | null = null;
    let lastFailure: Failure = "unknown";

    for (let index = 0; index < scored.length; index += 1) {
      const candidate = scored[index];
      const route = candidate.route;
      const gateway = candidate.gateway;
      const provider = candidate.provider;
      const successRate = candidate.metric.attempts ? Number(((candidate.metric.approvals / candidate.metric.attempts) * 100).toFixed(2)) : null;
      if (route.conditions?.health_guard !== false && candidate.metric.attempts >= 5 && successRate !== null && successRate < 50) { attempts.push({ gateway_id: route.gateway_id, provider, attempt: index + 1, outcome: "health_guard_skip", failure_class: "unavailable", reason: "gateway_degraded", success_rate: successRate, ai_score: candidate.score }); continue; }
      if (!gateway) { attempts.push({ gateway_id: route.gateway_id, provider, attempt: index + 1, outcome: "error", failure_class: "unavailable", reason: "gateway_not_found", ai_score: candidate.score }); lastFailure = "unavailable"; continue; }
      const sandbox = String(gateway.environment ?? gateway.env ?? "production").toLowerCase() !== "production" || provider === "sandbox";
      let result: { ok: boolean; failure?: Failure; reason: string; payload?: Record<string, unknown>; latencyMs: number };
      const started = Date.now();
      if (sandbox) {
        const simulation = String(metadata.simulate_failure ?? "").toLowerCase();
        if (simulation === "technical") result = { ok: false, failure: "technical", reason: "simulated_technical_failure", latencyMs: Date.now() - started };
        else if (simulation === "timeout") result = { ok: false, failure: "timeout", reason: "simulated_timeout", latencyMs: ATTEMPT_TIMEOUT_MS };
        else if (simulation === "card_decline") result = { ok: false, failure: "declined", reason: "simulated_card_decline", latencyMs: Date.now() - started };
        else result = { ok: true, reason: "sandbox_approved", payload: { status: "approved", id: `sbx_${crypto.randomUUID()}` }, latencyMs: Date.now() - started };
      } else result = await callAdapter(provider, gateway.id, { amount, currency, product_id: productId, funnel_id: funnelId, customer, payment_token: body.payment_token ?? body.vault_token ?? null, card_brand: brand, metadata, operation }, `${idempotencyKey}:${gateway.id}`);
      attempts.push({ gateway_id: gateway.id, provider, attempt: index + 1, outcome: result.ok ? "approved" : "failed", failure_class: result.failure ?? null, reason: result.reason, external_transaction_id: result.payload?.id ? String(result.payload.id) : result.payload?.transaction_id ? String(result.payload.transaction_id) : null, success_rate: successRate, ai_score: candidate.score, latency_ms: result.latencyMs });
      await adminClient.from("gateway_payment_attempts").insert({ user_id: userId, sale_id: null, product_id: productId, gateway_id: gateway.id, gateway_name: provider, routing_rule_id: route.id ?? null, idempotency_key: `${idempotencyKey}:${gateway.id}`, attempt_order: index + 1, status: result.ok ? "approved" : result.failure === "declined" ? "declined" : result.failure === "pending" ? "pending" : "error", failure_class: result.failure ?? null, external_transaction_id: result.payload?.id ? String(result.payload.id) : result.payload?.transaction_id ? String(result.payload.transaction_id) : null, error_message: result.ok ? null : result.reason, completed_at: new Date().toISOString() });
      if (result.ok) {
        const externalId = String(result.payload?.id ?? result.payload?.transaction_id ?? `sbx_${crypto.randomUUID()}`);
        const transactionResult = await adminClient.from("gateway_transactions").insert({ user_id: userId, funnel_id: funnelId, product_id: productId, gateway_id: gateway.id, external_id: externalId, idempotency_key: idempotencyKey, amount, currency, status: operation === "refund" ? "refunded" : "approved", customer, metadata: { ...metadata, smart_routing: true, ai_routing_score: candidate.score, sandbox, risk_score: risk.risk_score ?? null, card_brand: brand }, attempt_count: index + 1, completed_at: new Date().toISOString(), routing_metadata: { strategy: "ai_10m_conversion_score", requested_card_brand: brand, selected_score: candidate.score, attempts } }).select().single();
        if (transactionResult.error || !transactionResult.data) { const payload = { error: "transaction_create_failed", detail: transactionResult.error?.message ?? "empty_transaction" }; await complete("failed", 500, payload); return json(payload, 500); }
        transaction = transactionResult.data as Record<string, unknown>;
        break;
      }
      lastFailure = result.failure ?? "unknown";
      if (!canFailover(lastFailure) || route.fallback_enabled === false) break;
    }

    const finalGateway = transaction ? String(gatewayMap.get(String(transaction.gateway_id))?.provider ?? gatewayMap.get(String(transaction.gateway_id))?.name ?? transaction.gateway_id) : null;
    await adminClient.from("transaction_routing_logs").insert({ user_id: userId, amount, currency, card_brand: brand, gateways_attempted: attempts, final_gateway: finalGateway, status: transaction ? "approved" : lastFailure === "pending" ? "pending" : "failed", failure_class: transaction ? null : lastFailure, created_at: new Date().toISOString(), completed_at: new Date().toISOString(), idempotency_key: idempotencyKey });
    if (!transaction) {
      const statusCode = lastFailure === "pending" ? 202 : lastFailure === "declined" || lastFailure === "fraud" ? 402 : 503;
      const payload = { error: lastFailure === "pending" ? "payment_pending" : "payment_failed", failure_class: lastFailure, attempts, fallback_used: attempts.length > 1, routing: { strategy: "ai_10m_conversion_score", card_brand: brand } };
      await complete(lastFailure === "pending" ? "completed" : "failed", statusCode, payload);
      return json(payload, statusCode);
    }
    const payload = { transaction, attempts, fallback_used: attempts.length > 1, sandbox: String(gatewayMap.get(String(transaction.gateway_id))?.environment ?? "production").toLowerCase() !== "production", risk: { score: risk.risk_score ?? null, level: risk.risk_level ?? null, decision: risk.decision ?? null }, routing: { strategy: "ai_10m_conversion_score", card_brand: brand, selected_score: attempts.at(-1)?.ai_score ?? null } };
    await complete("completed", 200, payload, "gateway_transaction", String(transaction.id ?? ""));
    return json(payload);
  } catch (cause) {
    const payload = { error: "orchestrator_unhandled_error", detail: cause instanceof Error ? cause.message : "unknown_error" };
    await complete("failed", 500, payload);
    return json(payload, 500);
  }
});
