import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const secret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(url, key, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const normalizeProvider = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

const aliases: Record<string, string> = {
  paid: "approved", success: "approved", completed: "approved", captured: "approved", authorized: "approved",
  processing: "pending", pending: "pending", failed: "failed", declined: "failed",
  refunded: "refunded", refund: "refunded", chargeback: "chargeback", charged_back: "chargeback", disputed: "chargeback",
  created: "created",
};
const normalize = (v: unknown) => aliases[String(v ?? "").trim().toLowerCase()] ?? String(v ?? "").trim().toLowerCase();
const terminal = new Set(["refunded", "chargeback"]);

function providerMatches(eventProvider: unknown, gatewayData: unknown, gatewayId: string) {
  const requested = normalizeProvider(eventProvider);
  if (!requested) return true;
  const g = rec(gatewayData) ? gatewayData : {};
  const candidates = [g.provider, g.gateway_name, g.name, g.type, gatewayId].map(normalizeProvider).filter(Boolean);
  return candidates.includes(requested);
}

async function callAutomation(payload: Record<string, unknown>) {
  if (!secret) throw new Error("internal_secret_not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${url}/functions/v1/automation-engine-v2`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`automation_http_${response.status}`);
  } finally { clearTimeout(timer); }
}

async function processOne(event: Record<string, unknown>) {
  const id = String(event.id);
  const payload = rec(event.payload) ? event.payload : {};
  const rawStatus = String(payload.status ?? payload.payment_status ?? payload.transaction_status ?? payload.state ?? event.event_type).trim().toLowerCase();
  const status = normalize(rawStatus);
  const externalId = String(payload.external_id ?? payload.transaction_id ?? payload.payment_id ?? payload.id ?? event.external_id ?? "").trim();
  if (!externalId) return { ok: false, retry: false, reason: "external_transaction_id_missing" };
  if (!Object.prototype.hasOwnProperty.call(aliases, rawStatus)) return { ok: false, retry: false, reason: "unsupported_provider_status", status };

  const { data: candidates, error: txError } = await db.from("gateway_transactions")
    .select("id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,customer,metadata,gateways:gateway_id(data)")
    .eq("external_id", externalId).limit(20);
  if (txError) throw txError;
  const matches = (candidates ?? []).filter((tx: Record<string, unknown>) => providerMatches(event.provider, tx.gateways, String(tx.gateway_id)));
  if (matches.length > 1) throw new Error("ambiguous_external_transaction_id");
  const tx = matches[0] as Record<string, unknown> | undefined;
  if (!tx) return { ok: false, retry: false, reason: "transaction_not_found", external_id: externalId };

  const current = String(tx.status);
  if (terminal.has(current)) return { ok: true, already_terminal: true, transaction_id: tx.id, status: current };
  // A late technical event must never overwrite an already confirmed financial success.
  if (current === "approved" && ["failed", "pending", "created"].includes(status)) {
    return { ok: true, stale: true, transaction_id: tx.id, status: current };
  }
  if (status === "refunded" && !["approved", "pending"].includes(current)) return { ok: false, retry: false, reason: "invalid_refund_transition", current, status };
  if (status === "chargeback" && !["approved", "pending"].includes(current)) return { ok: false, retry: false, reason: "invalid_chargeback_transition", current, status };

  const transition = await db.rpc("transition_gateway_transaction_status", {
    p_transaction_id: String(tx.id), p_user_id: String(tx.user_id), p_next_status: status,
    p_failure_code: payload.failure_code ? String(payload.failure_code) : null, p_external_id: externalId,
  });
  if (transition.error) throw transition.error;
  const next = Array.isArray(transition.data) ? transition.data[0] : transition.data;

  if (status === "approved") {
    const existing = await db.from("sales").select("id").eq("user_id", tx.user_id).eq("transaction_id", tx.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      const sale = await db.from("sales").insert({
        id: `sale_${crypto.randomUUID()}`, user_id: tx.user_id, funnel_id: tx.funnel_id, transaction_id: tx.id,
        product_id: tx.product_id ?? null, amount: tx.amount, currency: tx.currency, status: "approved",
        external_id: externalId, gateway_id: tx.gateway_id, data: payload, occurred_at: new Date().toISOString(),
      });
      if (sale.error && sale.error.code !== "23505") throw sale.error;
    }
  }
  if (status === "refunded" || status === "chargeback") {
    const sale = await db.from("sales").update({ status, data: payload }).eq("user_id", tx.user_id).eq("transaction_id", tx.id);
    if (sale.error) throw sale.error;
  }

  await callAutomation({ user_id: tx.user_id, funnel_id: tx.funnel_id, event_id: id, event_type: String(event.event_type ?? "gateway.webhook"), transaction_id: tx.id, external_id: externalId, payload });
  return { ok: true, transaction_id: tx.id, status: String(next?.status ?? status), external_id: externalId };
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!secret || req.headers.get("x-internal-secret") !== secret) return json({ error: "unauthorized" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const requested = rec(body) && body.webhook_id ? String(body.webhook_id) : "";
    let events: Record<string, unknown>[] = [];
    if (requested) {
      const r = await db.from("gateway_webhook_events").select("*").eq("id", requested).maybeSingle();
      if (r.error) throw r.error;
      if (r.data) events = [r.data as Record<string, unknown>];
    } else {
      const r = await db.from("gateway_webhook_events").select("*").in("status", ["accepted", "failed"]).order("received_at", { ascending: true }).limit(50);
      if (r.error) throw r.error;
      events = (r.data ?? []) as Record<string, unknown>[];
    }
    let processed = 0, failed = 0, dead = 0;
    for (const event of events) {
      const id = String(event.id);
      const attempts = Number(event.attempts ?? 0) + 1;
      const claim = await db.from("gateway_webhook_events").update({ status: "processing", attempts, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["accepted", "failed"]).select("id").maybeSingle();
      if (claim.error || !claim.data) continue;
      try {
        const result = await processOne(event);
        if (!result.ok && result.retry === false) {
          await db.from("gateway_webhook_events").update({ status: "dead_letter", last_error: result.reason, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "processing");
          dead++; continue;
        }
        await db.from("gateway_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "processing");
        processed++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        const isDead = attempts >= 8;
        await db.from("gateway_webhook_events").update({ status: isDead ? "dead_letter" : "failed", last_error: msg, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "processing");
        if (isDead) dead++;
      }
    }
    return json({ ok: true, scanned: events.length, processed, failed, dead_lettered: dead });
  } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); }
});
