import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key, idempotency-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, serviceKey);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const funnelId = String(body.funnel_id ?? "");
  const amount = Number(body.amount ?? 0);
  const currency = String(body.currency ?? "BRL");
  const operation = String(body.operation ?? "create_payment");
  const productId = body.product_id ? String(body.product_id) : null;
  const idem = String(body.idempotency_key ?? req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key") ?? "");
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};

  if (!funnelId || amount <= 0 || !idem) return json({ error: "funnel_id_positive_amount_and_idempotency_key_required" }, 400);
  if (idem.length > 200) return json({ error: "idempotency_key_too_long" }, 400);

  const requestDigest = await digest({ funnelId, amount, currency, operation, productId, metadata, customer });
  const scope = `gateway-orchestrator:${funnelId}:${operation}`;
  const { data: reservation, error: reservationError } = await admin.rpc("reserve_idempotency_key", {
    p_user_id: user.id,
    p_scope: scope,
    p_idempotency_key: idem,
    p_request_digest: requestDigest,
    p_ttl: "24 hours",
  });
  if (reservationError) return json({ error: "idempotency_reservation_failed", detail: reservationError.message }, 500);

  const r = reservation?.[0];
  if (!r?.acquired) {
    if (r?.response_payload) return json(r.response_payload, Number(r.response_code ?? 200));
    return json({ error: "request_in_progress", idempotency_key: idem }, 409);
  }
  const reservationId = r.id;

  const complete = async (status: string, code: number, payload: unknown, resourceType: string | null = null, resourceId: string | null = null) => {
    await admin.rpc("complete_idempotency_key", {
      p_id: reservationId,
      p_status: status,
      p_response_code: code,
      p_response_payload: payload,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
    });
  };

  try {
    const { data: funnel } = await supabase.from("funnels").select("id").eq("id", funnelId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
    if (!funnel) { const payload = { error: "funnel_not_found" }; await complete("failed", 404, payload); return json(payload, 404); }

    let routeQuery = supabase.from("gateway_routes").select("*").eq("user_id", user.id).eq("funnel_id", funnelId).eq("enabled", true).order("priority", { ascending: true });
    if (productId) routeQuery = routeQuery.or(`product_id.eq.${productId},product_id.is.null`);
    const { data: routes, error: routesError } = await routeQuery;
    if (routesError) { const payload = { error: "route_lookup_failed", detail: routesError.message }; await complete("failed", 500, payload); return json(payload, 500); }
    if (!routes?.length) { const payload = { error: "no_active_gateway_route" }; await complete("failed", 409, payload); return json(payload, 409); }

    const gatewayIds = routes.map((route: any) => route.gateway_id);
    const { data: healthRows } = await admin.from("gateway_operation_logs").select("gateway_id,status,response_meta,created_at").eq("user_id", user.id).in("gateway_id", gatewayIds).gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).order("created_at", { ascending: false }).limit(500);
    const health = new Map<string, { total: number; ok: number }>();
    for (const row of healthRows ?? []) { const h = health.get(row.gateway_id) || { total: 0, ok: 0 }; h.total++; if (["success", "approved", "completed"].includes(String(row.status))) h.ok++; health.set(row.gateway_id, h); }

    const attempts: any[] = [];
    let transaction: any = null;
    let lastTechnicalError: string | null = null;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const h = health.get(route.gateway_id) || { total: 0, ok: 0 };
      const successRate = h.total ? Math.round((h.ok / h.total) * 10000) / 100 : null;
      const guard = route.conditions?.health_guard !== false;
      if (guard && route.fallback_enabled && h.total >= 5 && successRate !== null && successRate < 50) {
        attempts.push({ gateway_id: route.gateway_id, priority: route.priority, attempt: i + 1, outcome: "health_guard_skip", reason: "gateway_degraded", health: { total: h.total, success_rate: successRate } });
        continue;
      }

      const { data: gateway } = await supabase.from("gateways").select("*").eq("user_id", user.id).eq("id", route.gateway_id).maybeSingle();
      if (!gateway) { attempts.push({ gateway_id: route.gateway_id, priority: route.priority, outcome: "technical_failure", reason: "gateway_not_found" }); continue; }

      const provider = String(gateway.provider ?? gateway.type ?? gateway.name ?? "unknown").toLowerCase();
      const environment = String(gateway.environment ?? gateway.env ?? "sandbox").toLowerCase();
      const isSandbox = environment !== "production" || provider === "sandbox";
      const simulated = String(metadata.simulate_failure ?? "").toLowerCase();
      let outcome: "approved" | "technical_failure" | "card_decline" = "approved";
      let reason = "sandbox_approved";
      if (isSandbox && simulated === "technical") { outcome = "technical_failure"; reason = "simulated_technical_failure"; }
      if (isSandbox && simulated === "card_decline") { outcome = "card_decline"; reason = "simulated_card_decline"; }
      if (!isSandbox) { outcome = "technical_failure"; reason = "provider_adapter_not_configured"; }

      const attempt = i + 1;
      attempts.push({ gateway_id: route.gateway_id, priority: route.priority, attempt, outcome, reason, health: { total: h.total, success_rate: successRate } });
      await admin.from("gateway_operation_logs").insert({ user_id: user.id, gateway_id: route.gateway_id, operation, status: outcome === "approved" ? "success" : "failed", attempt, request_meta: { funnel_id: funnelId, product_id: productId, amount, currency, provider, environment }, response_meta: { outcome, reason, health: { total: h.total, success_rate: successRate } }, error_message: outcome === "approved" ? null : reason });

      if (outcome === "card_decline") { lastTechnicalError = reason; break; }
      if (outcome === "technical_failure") { lastTechnicalError = reason; if (!route.fallback_enabled) break; continue; }

      const externalId = `sbx_${crypto.randomUUID()}`;
      const { data: tx, error: txError } = await admin.from("gateway_transactions").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, gateway_id: route.gateway_id, external_id: externalId, idempotency_key: idem, amount, currency, status: operation === "refund" ? "refunded" : "approved", customer, metadata: { ...metadata, sandbox: isSandbox, operation }, attempt_count: attempt, completed_at: new Date().toISOString(), routing_metadata: { selected_priority: route.priority, attempts, health: { total: h.total, success_rate: successRate } } }).select().single();
      if (txError) { const payload = { error: "transaction_create_failed", detail: txError.message }; await complete("failed", 500, payload); return json(payload, 500); }
      transaction = tx;
      break;
    }

    if (!transaction) {
      const code = attempts.some((a) => a.outcome === "card_decline") ? 402 : 503;
      const payload = { transaction: await admin.from("gateway_transactions").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, gateway_id: attempts.at(-1)?.gateway_id ?? routes[0].gateway_id, external_id: `failed_${crypto.randomUUID()}`, idempotency_key: idem, amount, currency, status: "failed", customer, metadata: { ...metadata, operation }, error_message: lastTechnicalError ?? "gateway_failure", failure_code: attempts.at(-1)?.outcome === "card_decline" ? "card_decline" : "technical_failure", attempt_count: attempts.length, routing_metadata: { attempts } }).select().single().then((x) => x.data), attempts, fallback_used: attempts.length > 1 };
      await complete("failed", code, payload, "gateway_transaction", payload.transaction?.id ?? null);
      return json(payload, code);
    }

    let projection: any = null;
    if (transaction.status === "approved" && metadata.checkout_id) {
      const p = await admin.rpc("project_checkout_purchase", { p_checkout_id: String(metadata.checkout_id) });
      projection = p.error ? { ok: false, reason: "projection_failed" } : p.data;
    }
    const payload = { transaction, attempts, fallback_used: attempts.length > 1, sandbox: true, projection };
    await complete("completed", 200, payload, "gateway_transaction", transaction.id);
    return json(payload);
  } catch (error) {
    const payload = { error: "orchestrator_unhandled_error", detail: error instanceof Error ? error.message : "unknown_error" };
    await complete("failed", 500, payload);
    return json(payload, 500);
  }
});
