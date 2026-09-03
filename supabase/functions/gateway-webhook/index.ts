import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-signature, x-webhook-timestamp, x-provider-event-id, x-provider",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRole || !supabaseUrl) return json({ error: "server_configuration_error" }, 500);

  const providerRaw = request.headers.get("x-provider") ?? new URL(request.url).searchParams.get("provider") ?? "";
  const provider = providerRaw.trim().toLowerCase();
  if (!provider || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider)) return json({ error: "provider_required" }, 400);
  const secretName = `WEBHOOK_SECRET_${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
  const secret = Deno.env.get(secretName) ?? "";
  if (!secret) return json({ error: "webhook_secret_not_configured" }, 503);

  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return json({ error: "payload_too_large" }, 413);

  const signature = request.headers.get("x-webhook-signature") ?? "";
  const timestamp = request.headers.get("x-webhook-timestamp") ?? "";
  if (!signature || !timestamp) return json({ error: "signature_required" }, 401);
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return json({ error: "stale_webhook" }, 401);

  const expected = await hmac(secret, `${timestamp}.${rawBody}`);
  const supplied = signature.replace(/^sha256=/, "").trim().toLowerCase();
  if (!timingSafeEqual(expected, supplied)) return json({ error: "invalid_signature" }, 401);

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_payload" }, 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const eventId = request.headers.get("x-provider-event-id") ?? String(payload.id ?? payload.event_id ?? payload.eventId ?? "");
  if (!eventId || eventId.length > 300) return json({ error: "provider_event_id_required" }, 400);

  const admin = createClient(supabaseUrl, serviceRole);
  const { data, error } = await admin.rpc("ingest_gateway_webhook", {
    p_provider: provider,
    p_provider_event_id: eventId,
    p_signature_timestamp: new Date(timestampMs).toISOString(),
    p_payload: payload,
  });
  if (error) return json({ error: "webhook_ingestion_failed", detail: error.message }, 500);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.duplicate) return json({ ok: true, duplicate: true, event_id: eventId });
  return json({ ok: true, accepted: true, event_id: eventId, webhook_id: row?.webhook_id ?? null }, 202);
});
