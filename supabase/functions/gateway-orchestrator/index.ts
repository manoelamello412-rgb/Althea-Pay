import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const funnelId = String(body.funnel_id ?? "");
  const amount = Number(body.amount ?? 0);
  const currency = String(body.currency ?? "BRL");
  const operation = String(body.operation ?? "create_payment");
  const productId = body.product_id ? String(body.product_id) : null;
  const idem = String(body.idempotency_key ?? req.headers.get("x-idempotency-key") ?? "");
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};

  if (!funnelId || amount <= 0 || !idem) return json({ error: "funnel_id_positive_amount_and_idempotency_key_required" }, 400);

  const { data: existing } = await supabase.from("gateway_transactions").select("*").eq("user_id", user.id).eq("idempotency_key", idem).maybeSingle();
  if (existing) return json({ transaction: existing, replayed: true });

  let routeQuery = supabase.from("gateway_routes").select("*").eq("user_id", user.id).eq("funnel_id", funnelId).eq("enabled", true).order("priority", { ascending: true });
  if (productId) routeQuery = routeQuery.or(`product_id.eq.${productId},product_id.is.null`);
  const { data: routes, error: routesError } = await routeQuery;
  if (routesError) return json({ error: "route_lookup_failed", detail: routesError.message }, 500);
  if (!routes?.length) return json({ error: "no_active_gateway_route" }, 409);

  const attempts: any[] = [];
  let transaction: any = null;
  let lastTechnicalError: string | null = null;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const { data: gateway } = await supabase.from("gateways").select("*").eq("user_id", user.id).eq("id", route.gateway_id).maybeSingle();
    if (!gateway) {
      attempts.push({ gateway_id: route.gateway_id, priority: route.priority, outcome: "technical_failure", reason: "gateway_not_found" });
      continue;
    }

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
    attempts.push({ gateway_id: route.gateway_id, priority: route.priority, attempt, outcome, reason });
    await supabase.from("gateway_operation_logs").insert({
      user_id: user.id,
      gateway_id: route.gateway_id,
      operation,
      status: outcome === "approved" ? "success" : "failed",
      attempt,
      request_meta: { funnel_id: funnelId, product_id: productId, amount, currency, provider, environment },
      response_meta: { outcome, reason },
      error_message: outcome === "approved" ? null : reason,
    });

    if (outcome === "card_decline") {
      lastTechnicalError = reason;
      break;
    }
    if (outcome === "technical_failure") {
      lastTechnicalError = reason;
      if (!route.fallback_enabled) break;
      continue;
    }

    const externalId = `sbx_${crypto.randomUUID()}`;
    const { data: tx, error: txError } = await supabase.from("gateway_transactions").insert({
      user_id: user.id,
      funnel_id: funnelId,
      product_id: productId,
      gateway_id: route.gateway_id,
      external_id: externalId,
      idempotency_key: idem,
      amount,
      currency,
      status: operation === "refund" ? "refunded" : "approved",
      customer,
      metadata: { ...metadata, sandbox: isSandbox, operation },
      attempt_count: attempt,
      completed_at: new Date().toISOString(),
      routing_metadata: { selected_priority: route.priority, attempts },
    }).select().single();
    if (txError) return json({ error: "transaction_create_failed", detail: txError.message }, 500);
    transaction = tx;
    break;
  }

  if (!transaction) {
    const { data: failedTx } = await supabase.from("gateway_transactions").insert({
      user_id: user.id,
      funnel_id: funnelId,
      product_id: productId,
      gateway_id: attempts[attempts.length - 1]?.gateway_id ?? routes[0].gateway_id,
      external_id: `failed_${crypto.randomUUID()}`,
      idempotency_key: idem,
      amount,
      currency,
      status: "failed",
      customer,
      metadata: { ...metadata, operation },
      error_message: lastTechnicalError ?? "gateway_failure",
      failure_code: attempts[attempts.length - 1]?.outcome === "card_decline" ? "card_decline" : "technical_failure",
      attempt_count: attempts.length,
      routing_metadata: { attempts },
    }).select().single();
    return json({ transaction: failedTx, attempts, fallback_used: attempts.length > 1 }, 402);
  }

  return json({ transaction, attempts, fallback_used: attempts.length > 1, sandbox: true });
});
