import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";
import { pushcutMessage } from "../_shared/pushcut.ts";

// Drains public.outbound_webhook_events (filled by DB triggers: transaction.* and message.received).
// Woken by pg_net right after the event commits, with a 5-minute cron as backstop.
// Legacy callers (althea-webhook) may still POST {organization_id, event_type, payload}: it is queued first.

type Json = Record<string, unknown>;
type Event = { id: string; organization_id: string; event_type: string; funnel_id: string | null; payload: Json; target_webhook_id: string | null; attempts: number; created_at: string };
type Webhook = { id: string; user_id: string; endpoint_url: string; events: string[]; funnel_id: string | null; kind: string };

const json = (body: unknown, status = 200) => Response.json(body, { status });
const enc = new TextEncoder();
async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((v) => v.toString(16).padStart(2, "0")).join("");
}

const url = Deno.env.get("SUPABASE_URL") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function authorized(req: Request) {
  const supplied = req.headers.get("x-internal-secret") ?? "";
  if (!supplied) return false;
  const env = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
  if (env && supplied === env) return true;
  const verified = await db.rpc("verify_althea_internal_secret", { p_secret: supplied });
  return verified.data === true;
}

// Returns true when the delivery should be retried later.
async function deliver(event: Event, wh: Webhook): Promise<boolean> {
  const idempotencyKey = `${event.id}:${wh.id}`;
  const previous = await db.from("outbound_webhook_deliveries").select("status").eq("webhook_id", wh.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (previous.data?.status === "delivered") return false;

  const payload = { id: event.id, type: event.event_type, created_at: event.created_at, data: event.payload };
  const pushcut = wh.kind === "pushcut";
  const body = JSON.stringify(pushcut ? pushcutMessage(event.event_type, event.payload) : payload);
  const started = Date.now();
  let status = "retry", code: number | null = null, errorMessage: string | null = null;

  const guard = await assertPublicHttpsUrl(wh.endpoint_url);
  if (!guard.ok) {
    status = "failed";
    errorMessage = `blocked_${guard.reason}`;
  } else {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!pushcut) {
      const secret = await db.rpc("outbound_webhook_secret_v1", { p_webhook_id: wh.id });
      Object.assign(headers, { "x-althea-event": event.event_type, "x-althea-event-id": event.id, "x-althea-idempotency-key": idempotencyKey });
      if (typeof secret.data === "string" && secret.data) headers["x-althea-signature"] = await sign(secret.data, body);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(guard.url, { method: "POST", redirect: "error", signal: controller.signal, headers, body });
      clearTimeout(timeout);
      code = r.status;
      const text = (await r.text().catch(() => "")).slice(0, 500);
      if (r.ok) status = "delivered";
      else {
        errorMessage = `http_${r.status}${text ? `: ${text}` : ""}`;
        if (r.status < 500 && r.status !== 429) status = "failed";
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "delivery_failed";
    }
  }

  await db.from("outbound_webhook_deliveries").upsert({
    webhook_id: wh.id, user_id: wh.user_id, organization_id: event.organization_id, event_type: event.event_type,
    idempotency_key: idempotencyKey, status, attempt: event.attempts, response_code: code, response_time_ms: Date.now() - started,
    error_message: errorMessage, payload, delivered_at: status === "delivered" ? new Date().toISOString() : null,
    next_retry_at: status === "retry" ? new Date(Date.now() + 60000 * 2 ** event.attempts).toISOString() : null,
  }, { onConflict: "webhook_id,idempotency_key" });
  return status === "retry";
}

async function processEvent(event: Event) {
  let query = db.from("outbound_webhooks").select("id,user_id,endpoint_url,events,funnel_id,kind").eq("organization_id", event.organization_id);
  query = event.target_webhook_id ? query.eq("id", event.target_webhook_id) : query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  const targets = ((data ?? []) as Webhook[]).filter((wh) => event.target_webhook_id ||
    ((wh.events.includes(event.event_type) || wh.events.includes("*")) && (!wh.funnel_id || wh.funnel_id === event.funnel_id)));
  let retry = false;
  for (const wh of targets) retry = (await deliver(event, wh)) || retry;
  return { event_id: event.id, webhooks: targets.length, retry };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!url || !service) return json({ error: "server_configuration_error" }, 500);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  const b = await req.json().catch(() => ({})) as Json;
  if (b.event_type && b.organization_id) {
    const queued = await db.from("outbound_webhook_events").insert({
      organization_id: String(b.organization_id), event_type: String(b.event_type),
      funnel_id: (b.payload as Json | undefined)?.funnel_id ? String((b.payload as Json).funnel_id) : null, payload: b.payload ?? {},
    });
    if (queued.error) return json({ error: "enqueue_failed" }, 500);
  }

  const claimed = await db.rpc("outbound_webhook_claim_v1", { p_limit: 25 });
  if (claimed.error) return json({ error: "claim_failed" }, 500);
  const results = [];
  for (const event of (claimed.data ?? []) as Event[]) {
    let retry = true;
    try {
      const result = await processEvent(event);
      retry = result.retry;
      results.push(result);
    } catch (e) {
      results.push({ event_id: event.id, error: e instanceof Error ? e.message : "process_failed" });
    }
    await db.rpc("outbound_webhook_finish_v1", { p_event_id: event.id, p_retry: retry });
  }
  return json({ ok: true, processed: results.length, results });
});
