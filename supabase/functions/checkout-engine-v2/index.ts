import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
if (!URL || !SERVICE || !ANON) throw new Error("checkout_server_configuration_error");

const db = createClient(URL, SERVICE);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function getUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = createClient(URL!, ANON!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const result = await client.auth.getUser(token);
  return result.error ? null : result.data.user;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "invalid_json" }, 400);

  const funnelId = String(body.funnel_id || "").trim();
  const productId = body.product_id ? String(body.product_id).trim() : null;
  const amount = Number(body.amount);
  const currency = String(body.currency || "BRL").toUpperCase();
  const action = body.action === "purchase" ? "purchase" : "start";
  const suppliedKey = String(req.headers.get("x-idempotency-key") || req.headers.get("idempotency-key") || body.idempotency_key || "").trim();
  const idempotencyKey = suppliedKey || crypto.randomUUID();
  const checkoutIdempotencyKey = action === "purchase" ? idempotencyKey : `start:${idempotencyKey}`;

  if (!funnelId || !Number.isFinite(amount) || amount <= 0 || idempotencyKey.length > 300) return json({ error: "invalid_checkout" }, 400);
  if (!/^[A-Za-z0-9._:-]{1,300}$/.test(idempotencyKey)) return json({ error: "invalid_idempotency_key" }, 400);
  if (["card_data", "pan", "card_number", "cardNumber", "cvv", "cvc"].some((k) => body[k] !== undefined)) return json({ error: "raw_card_data_forbidden" }, 400);

  const { data: funnel } = await db.from("funnels").select("id").eq("id", funnelId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
  if (!funnel) return json({ error: "funnel_not_found" }, 404);
  if (productId) {
    const { data: product, error } = await db.from("products").select("id").eq("id", productId).eq("user_id", user.id).maybeSingle();
    if (error) return json({ error: "product_lookup_failed" }, 500);
    if (!product) return json({ error: "product_not_found" }, 404);
  }

  const attribution = isRecord(body.attribution) ? body.attribution : {};
  const customer = isRecord(body.customer) ? body.customer : {};
  const metadata = { ...(isRecord(body.metadata) ? body.metadata : {}), idempotency_key: idempotencyKey, source: "checkout-engine-v2" };
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ funnelId, productId, amount, currency, action, attribution, customer, metadata })));
  const requestDigest = Array.from(new Uint8Array(digestBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data: reservation, error: reservationError } = await db.rpc("reserve_idempotency_key", { p_user_id: user.id, p_scope: `checkout-engine-v2:${funnelId}:${action}`, p_idempotency_key: checkoutIdempotencyKey, p_request_digest: requestDigest, p_ttl: "24 hours" });
  if (reservationError) return json({ error: "idempotency_reservation_failed" }, 500);
  const lock = Array.isArray(reservation) ? reservation[0] as Record<string, unknown> | undefined : undefined;
  if (!lock?.acquired) {
    if (lock?.response_payload) return json(lock.response_payload, Number(lock.response_code ?? 200));
    return json({ error: "request_in_progress", idempotency_key: idempotencyKey }, 409);
  }

  const reservationId = String(lock.id || "");
  const leaseToken = lock.lease_token ? String(lock.lease_token) : null;
  let completed = false;
  const complete = async (status: "completed" | "failed", responseCode: number, payload: unknown, resourceId?: string) => {
    if (completed || !reservationId) return;
    const { error } = await db.rpc("complete_idempotency_key", { p_id: reservationId, p_status: status, p_response_code: responseCode, p_response_payload: payload, p_resource_type: resourceId ? "checkout_session" : null, p_resource_id: resourceId ?? null, p_lease_token: leaseToken });
    if (!error) completed = true;
  };

  try {
    const { data: checkout, error: checkoutError } = await db.from("checkout_sessions").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, status: action === "purchase" ? "processing" : "started", currency, amount, customer, attribution, metadata, idempotency_key: checkoutIdempotencyKey }).select().single();

    if (checkoutError) {
      if (checkoutError.code === "23505") {
        const { data: existing, error: existingError } = await db.from("checkout_sessions").select("*").eq("user_id", user.id).eq("funnel_id", funnelId).eq("idempotency_key", checkoutIdempotencyKey).maybeSingle();
        if (existingError) { const p = { error: "checkout_lookup_failed" }; await complete("failed", 500, p); return json(p, 500); }
        if (existing) {
          const status = String(existing.status || "");
          const code = status === "completed" || status === "failed" ? 200 : 202;
          const p = status === "completed" || status === "failed" ? { checkout: existing, replayed: true } : { checkout: existing, pending: true, replayed: true };
          await complete("completed", code, p, String(existing.id));
          return json(p, code);
        }
        const p = { error: "checkout_conflict_retryable" }; await complete("failed", 409, p); return json(p, 409);
      }
      const p = { error: "checkout_create_failed" }; await complete("failed", 500, p); return json(p, 500);
    }

    const checkoutEvent = await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: action === "purchase" ? "purchase_requested" : "checkout_started", payload: { funnel_id: funnelId, product_id: productId, amount, currency } });
    if (checkoutEvent.error) {
      const p = { error: "checkout_event_failed" };
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["started", "processing"]);
      await complete("failed", 500, p, String(checkout.id)); return json(p, 500);
    }

    if (action !== "purchase") { const p = { checkout, replayed: false }; await complete("completed", 200, p, String(checkout.id)); return json(p); }

    const gatewayResponse = await fetch(`${URL}/functions/v1/gateway-orchestrator`, { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.get("authorization") || "", "x-idempotency-key": idempotencyKey }, body: JSON.stringify({ funnel_id: funnelId, product_id: productId, amount, currency, customer, metadata: { ...metadata, checkout_id: checkout.id }, idempotency_key: idempotencyKey }) });
    const gateway = await gatewayResponse.json().catch(() => ({ error: "gateway_invalid_response" }));

    if (!gatewayResponse.ok) {
      const pending = gatewayResponse.status === 202 || (isRecord(gateway) && (gateway.error === "payment_pending" || gateway.failure_class === "pending"));
      if (pending) {
        const pendingCheckout = { ...checkout, status: "processing" };
        await db.from("checkout_sessions").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
        await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "payment_pending", payload: { gateway } });
        const p = { checkout: pendingCheckout, gateway, pending: true, replayed: false }; await complete("completed", 202, p, String(checkout.id)); return json(p, 202);
      }
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      const code = gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? gatewayResponse.status : 502;
      const p = { error: "payment_failed", checkout: { ...checkout, status: "failed" }, gateway }; await complete("completed", code, p, String(checkout.id)); return json(p, code);
    }

    const transactionId = isRecord(gateway) ? String(gateway.transaction_id || (isRecord(gateway.transaction) ? gateway.transaction.id : "")) : "";
    const { data: transaction } = transactionId ? await db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", user.id).eq("funnel_id", funnelId).maybeSingle() : { data: null };
    if (!transaction || !["approved", "pending"].includes(String(transaction.status))) {
      await db.from("checkout_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      const p = { error: "payment_failed", checkout: { ...checkout, status: "failed" }, gateway }; await complete("failed", 402, p, String(checkout.id)); return json(p, 402);
    }
    if (String(transaction.status) === "pending") {
      await db.from("checkout_sessions").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
      await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "payment_pending", payload: { transaction_id: transactionId, gateway } });
      const p = { checkout: { ...checkout, status: "processing" }, gateway, transaction, pending: true, replayed: false }; await complete("completed", 202, p, String(checkout.id)); return json(p, 202);
    }

    await db.from("checkout_sessions").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", checkout.id).eq("user_id", user.id).in("status", ["processing", "started"]);
    const externalId = transaction.external_id || (isRecord(gateway) ? gateway.external_id : null) || null;
    let sale = (await db.from("sales").select("*").eq("user_id", user.id).eq("transaction_id", transactionId).maybeSingle()).data;
    if (!sale) {
      const insertedSale = await db.from("sales").insert({ user_id: user.id, funnel_id: funnelId, product_id: productId, checkout_id: checkout.id, transaction_id: transactionId, amount, currency, status: "approved", attribution, external_id: externalId, gateway_id: transaction.gateway_id || (isRecord(gateway) ? gateway.gateway_id : null) || null, occurred_at: new Date().toISOString() }).select().single();
      if (insertedSale.error && insertedSale.error.code !== "23505") { const p = { error: "sale_projection_failed" }; await complete("failed", 500, p, String(checkout.id)); return json(p, 500); }
      sale = insertedSale.data ?? (await db.from("sales").select("*").eq("user_id", user.id).eq("transaction_id", transactionId).maybeSingle()).data;
    }
    if (!sale) { const p = { error: "sale_projection_failed" }; await complete("failed", 500, p, String(checkout.id)); return json(p, 500); }

    const attributionResult = await db.rpc("project_sale_attribution", { p_sale_id: String(sale.id) });
    if (attributionResult.error) { const p = { error: "sale_attribution_projection_failed" }; await complete("failed", 500, p, String(checkout.id)); return json(p, 500); }

    const approvedEvent = await db.from("checkout_events").insert({ checkout_id: checkout.id, user_id: user.id, event_type: "purchase_approved", payload: { transaction_id: transactionId, sale_id: sale.id } });
    if (approvedEvent.error && approvedEvent.error.code !== "23505") { const p = { error: "checkout_event_failed" }; await complete("failed", 500, p, String(checkout.id)); return json(p, 500); }

    const eventKey = `checkout:${checkout.id}:purchase`;
    const { data: existingEvent } = await db.from("integration_events").select("id").eq("user_id", user.id).eq("event_key", eventKey).maybeSingle();
    if (!existingEvent) {
      const insertedEvent = await db.from("integration_events").insert({ user_id: user.id, funnel_id: funnelId, event_type: "purchase", event_key: eventKey, external_id: externalId || idempotencyKey, payload: { checkout_id: checkout.id, transaction_id: transactionId, sale_id: sale.id, amount, currency, product_id: productId, attribution, customer }, status: "pending" });
      if (insertedEvent.error && insertedEvent.error.code !== "23505") { const p = { error: "integration_event_failed" }; await complete("failed", 500, p, String(checkout.id)); return json(p, 500); }
    }

    const p = { checkout: { ...checkout, status: "completed" }, gateway, sale, replayed: false }; await complete("completed", 200, p, String(checkout.id)); return json(p);
  } catch (error) {
    const p = { error: "checkout_unhandled_error" }; await complete("failed", 500, p);
    console.error("checkout.unhandled", error instanceof Error ? error.message : "unknown_error");
    return json(p, 500);
  } finally {
    if (!completed && reservationId) await complete("failed", 500, { error: "checkout_aborted" });
  }
});
