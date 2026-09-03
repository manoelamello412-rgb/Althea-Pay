import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const db = createClient(URL, SERVICE);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function getUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const result = await client.auth.getUser(token);
  return result.error ? null : result.data.user;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "invalid_json" }, 400);

  const funnelId = String(body.funnel_id || "");
  const productId = body.product_id ? String(body.product_id) : null;
  const amount = Number(body.amount);
  const currency = String(body.currency || "BRL").toUpperCase();
  const action = body.action === "purchase" ? "purchase" : "start";
  const idempotencyKey = String(req.headers.get("x-idempotency-key") || req.headers.get("idempotency-key") || body.idempotency_key || crypto.randomUUID()).trim();

  if (!funnelId || !Number.isFinite(amount) || amount <= 0 || !idempotencyKey || idempotencyKey.length > 300) return json({ error: "invalid_checkout" }, 400);

  const { data: funnel } = await db.from("funnels").select("id").eq("id", funnelId).eq("user_id", user.id).maybeSingle();
  if (!funnel) return json({ error: "funnel_not_found" }, 404);

  if (productId) {
    const { data: product, error: productError } = await db.from("products").select("id").eq("id", productId).eq("user_id", user.id).maybeSingle();
    if (productError) return json({ error: "product_lookup_failed", detail: productError.message }, 500);
    if (!product) return json({ error: "product_not_found" }, 404);
  }

  const attribution = body.attribution && typeof body.attribution === "object" ? body.attribution : {};
  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};
  const metadata = { ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}), idempotency_key: idempotencyKey, source: "checkout-engine-v2" };

  const { data: checkout, error: checkoutError } = await db.from("checkout_sessions").insert({
    user_id: user.id, funnel_id: funnelId, product_id: productId,
    status: action === "purchase" ? "processing" : "started", currency, amount,
    customer, attribution, metadata, idempotency_key: idempotencyKey,
  }).select().single();

  if (checkoutError) {
    if (checkoutError.code === "23505") {
      const { data: existing, error: existingError } = await db.from("checkout_sessions").select("*").eq("user_id", user.id).eq("funnel_id", funnelId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existingError) return json({ error: "checkout_lookup_failed", detail: existingError.message }, 500);
      if (existing) return json({ checkout: existing, replayed: true });
    }
    return json({ error: "checkout_create_failed", detail: checkoutError.message }, 500);
  }

  await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: action === "purchase" ? "purchase_requested" : "checkout_started", payload: { funnel_id: funnelId, product_id: productId, amount, currency } });
  if (action !== "purchase") return json({ checkout, replayed: false });

  const gatewayResponse = await fetch(`${URL}/functions/v1/gateway-orchestrator`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: req.headers.get("authorization") || "", "x-idempotency-key": idempotencyKey },
    body: JSON.stringify({ funnel_id: funnelId, product_id: productId, amount, currency, customer, metadata: { ...metadata, checkout_id: checkout.id }, idempotency_key: idempotencyKey }),
  });
  const gateway = await gatewayResponse.json().catch(() => ({ error: "gateway_invalid_response" }));
  if (!gatewayResponse.ok) {
    const pendingFailure = gatewayResponse.status === 202 || (gateway && typeof gateway === "object" && (gateway.error === "payment_pending" || gateway.failure_class === "pending"));
    if (pendingFailure) {
      const pendingCheckout = { ...checkout, status: "processing" };
      await db.from("checkout_sessions").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id);
      await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "payment_pending", payload: { gateway } });
      return json({ checkout: pendingCheckout, gateway, pending: true, replayed: false }, 202);
    }
    await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id);
    return json({ error: "payment_failed", checkout: { ...checkout, status: "failed" }, gateway }, gatewayResponse.status);
  }

  const transactionId = gateway.transaction_id || gateway.transaction?.id;
  const { data: transaction } = transactionId ? await db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", user.id).maybeSingle() : { data: null };
  if (!transaction || transaction.status !== "approved") {
    const isPending = gateway?.failure_class === "pending" || gateway?.error === "payment_pending" || transaction?.status === "pending";
    if (isPending) {
      await db.from("checkout_sessions").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id);
      await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "payment_pending", payload: { transaction_id: transactionId, gateway } });
      return json({ checkout: { ...checkout, status: "processing" }, gateway, transaction, pending: true, replayed: false }, 202);
    }
    await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id);
    return json({ error: "payment_failed", checkout: { ...checkout, status: "failed" }, gateway }, 402);
  }

  await db.from("checkout_sessions").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id);
  const externalId = transaction.external_id || gateway.external_id || null;
  let sale = (await db.from("sales").select("*").eq("user_id", user.id).eq("transaction_id", transactionId).maybeSingle()).data;
  if (!sale) {
    const insertedSale = await db.from("sales").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, checkout_id: checkout.id, transaction_id: transactionId, amount, currency, status: "approved", attribution, external_id: externalId, gateway_id: transaction.gateway_id || gateway.gateway_id || null, occurred_at: new Date().toISOString() }).select().single();
    if (insertedSale.error) return json({ error: "sale_projection_failed", detail: insertedSale.error.message }, 500);
    sale = insertedSale.data;
  }
  if (sale?.id) await db.rpc("project_sale_attribution", { p_sale_id: String(sale.id) });

  await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "purchase_approved", payload: { transaction_id: transactionId, sale_id: sale.id } });
  const eventKey = `checkout:${checkout.id}:purchase`;
  const { data: existingEvent } = await db.from("integration_events").select("id").eq("user_id", user.id).eq("event_key", eventKey).maybeSingle();
  if (!existingEvent) await db.from("integration_events").insert({ user_id: user.id, funnel_id: funnelId, event_type: "purchase", event_key: eventKey, external_id: externalId || idempotencyKey, payload: { checkout_id: checkout.id, transaction_id: transactionId, sale_id: sale.id, amount, currency, product_id: productId, attribution, customer }, status: "pending" });

  return json({ checkout: { ...checkout, status: "completed" }, gateway, sale, replayed: false });
});
