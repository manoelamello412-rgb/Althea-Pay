import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, "content-type": "application/json" } });
const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function makeSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${[...bytes].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeEndpoint(value: string) {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error("invalid_url"); }
  if (parsed.protocol !== "https:") throw new Error("https_required");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") throw new Error("private_destination_blocked");
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) throw new Error("private_destination_blocked");
  return parsed.toString();
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(authorization.slice(7));
  return data.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const user = await authenticate(req);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "create") {
      const endpoint_url = normalizeEndpoint(String(body.endpoint_url ?? ""));
      const name = String(body.name ?? "Webhook").trim().slice(0, 120) || "Webhook";
      const events = Array.isArray(body.events) && body.events.length
        ? body.events.map(String).slice(0, 50)
        : ["transaction.approved", "transaction.failed"];
      const secret = makeSecret();
      const stored = await admin.rpc("store_webhook_secret", { p_secret: secret, p_name: `ALTHEA outbound webhook ${user.id}` });
      if (stored.error) throw stored.error;
      const { data, error } = await admin.from("outbound_webhooks").insert({
        user_id: user.id,
        name,
        endpoint_url,
        secret_ref: String(stored.data),
        secret_hash: await sha256(secret),
        events,
        status: "active",
        max_attempts: 5,
      }).select("id,name,endpoint_url,events,status,max_attempts,created_at,updated_at").single();
      if (error) throw error;
      return json({ ok: true, webhook: data, secret, secret_once: true }, 201);
    }

    const id = String(body.id ?? "");
    if (!id) return json({ ok: false, error: "id_required" }, 400);
    const owned = await admin.from("outbound_webhooks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return json({ ok: false, error: "not_found" }, 404);

    if (action === "rotate") {
      const secret = makeSecret();
      const stored = await admin.rpc("store_webhook_secret", { p_secret: secret, p_name: `ALTHEA outbound webhook ${id}` });
      if (stored.error) throw stored.error;
      const { data, error } = await admin.from("outbound_webhooks").update({ secret_ref: String(stored.data), secret_hash: await sha256(secret), updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).select("id,name,endpoint_url,events,status,max_attempts,updated_at").single();
      if (error) throw error;
      return json({ ok: true, webhook: data, secret, secret_once: true });
    }

    if (action === "toggle") {
      const status = String(body.status) === "disabled" ? "disabled" : "active";
      const { data, error } = await admin.from("outbound_webhooks").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id).select("id,name,endpoint_url,events,status,max_attempts,updated_at").single();
      if (error) throw error;
      return json({ ok: true, webhook: data });
    }

    if (action === "delete") {
      const { error } = await admin.from("outbound_webhooks").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "operation_failed" }, 400);
  }
});
