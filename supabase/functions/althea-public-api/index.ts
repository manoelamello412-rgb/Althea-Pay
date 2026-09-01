import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-althea-api-key, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200, extra: Record<string,string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra } });

const textEncoder = new TextEncoder();
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function requestId(req: Request) {
  return req.headers.get("x-request-id") || crypto.randomUUID();
}

function hasScope(scopes: string[], required: string) {
  return scopes.includes("*") || scopes.includes(required);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function authenticateApiKey(req: Request) {
  const raw = req.headers.get("x-althea-api-key") || req.headers.get("apikey");
  if (!raw) return { error: "missing_api_key" as const };
  const hash = await sha256(raw);
  const { data: key, error } = await admin.from("api_keys").select("id,user_id,name,key_prefix,scopes,expires_at,revoked_at").eq("key_hash", hash).maybeSingle();
  if (error || !key) return { error: "invalid_api_key" as const };
  if (key.revoked_at) return { error: "revoked_api_key" as const };
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return { error: "expired_api_key" as const };
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  return { key };
}

async function logRequest(userId: string, keyId: string, reqId: string, req: Request, status: number, started: number, scope?: string, errorCode?: string) {
  await admin.from("api_request_logs").insert({
    user_id: userId, api_key_id: keyId, request_id: reqId, method: req.method,
    path: new URL(req.url).pathname, status_code: status, latency_ms: Date.now() - started,
    scope: scope ?? null, error_code: errorCode ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const rid = requestId(req);
  const started = Date.now();
  const auth = await authenticateApiKey(req);
  if ("error" in auth) return json({ ok: false, error: auth.error, request_id: rid }, 401, { "x-request-id": rid });
  const key = auth.key;
  const scopes = Array.isArray(key.scopes) ? key.scopes.map(String) : [];
  const path = new URL(req.url).pathname.replace(/^\/functions\/v1\/althea-public-api/, "") || "/";

  const respond = async (body: unknown, status = 200, scope?: string, errorCode?: string) => {
    await logRequest(key.user_id, key.id, rid, req, status, started, scope, errorCode);
    return json({ ...((body && typeof body === "object") ? body : { data: body }), request_id: rid }, status, { "x-request-id": rid });
  };

  try {
    if (req.method === "GET" && path === "/v1") {
      return await respond({ ok: true, service: "althea-public-api", version: "v1", authenticated: true });
    }

    if (req.method === "GET" && path === "/v1/funnels") {
      if (!hasScope(scopes, "funnels:read")) return await respond({ ok: false, error: "insufficient_scope" }, 403, "funnels:read", "insufficient_scope");
      const { data, error } = await admin.from("funnels").select("id,name,status,created_at").eq("user_id", key.user_id).order("created_at", { ascending: false });
      if (error) return await respond({ ok: false, error: "database_error" }, 500, "funnels:read", "database_error");
      return await respond({ ok: true, data }, 200, "funnels:read");
    }

    if (req.method === "GET" && path === "/v1/products") {
      if (!hasScope(scopes, "products:read")) return await respond({ ok: false, error: "insufficient_scope" }, 403, "products:read", "insufficient_scope");
      const { data, error } = await admin.from("products").select("id,name,status,price,currency,created_at").eq("user_id", key.user_id).order("created_at", { ascending: false });
      if (error) return await respond({ ok: false, error: "database_error" }, 500, "products:read", "database_error");
      return await respond({ ok: true, data }, 200, "products:read");
    }

    if (req.method === "GET" && path === "/v1/sales") {
      if (!hasScope(scopes, "sales:read")) return await respond({ ok: false, error: "insufficient_scope" }, 403, "sales:read", "insufficient_scope");
      const { data, error } = await admin.from("sales").select("*").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(100);
      if (error) return await respond({ ok: false, error: "database_error" }, 500, "sales:read", "database_error");
      return await respond({ ok: true, data }, 200, "sales:read");
    }

    if (req.method === "GET" && path === "/v1/transactions") {
      if (!hasScope(scopes, "transactions:read")) return await respond({ ok: false, error: "insufficient_scope" }, 403, "transactions:read", "insufficient_scope");
      const { data, error } = await admin.from("gateway_transactions").select("*").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(100);
      if (error) return await respond({ ok: false, error: "database_error" }, 500, "transactions:read", "database_error");
      return await respond({ ok: true, data }, 200, "transactions:read");
    }

    if (req.method === "POST" && path === "/v1/events") {
      if (!hasScope(scopes, "events:write")) return await respond({ ok: false, error: "insufficient_scope" }, 403, "events:write", "insufficient_scope");
      const body = await req.json().catch(() => null);
      if (!body || typeof body.event_type !== "string") return await respond({ ok: false, error: "invalid_event" }, 400, "events:write", "invalid_event");
      const externalId = typeof body.external_id === "string" ? body.external_id : null;
      if (externalId) {
        const { data: existing } = await admin.from("integration_events").select("id,event_type,status,created_at").eq("user_id", key.user_id).eq("external_id", externalId).maybeSingle();
        if (existing) return await respond({ ok: true, duplicate: true, data: existing }, 200, "events:write");
      }
      const { data, error } = await admin.from("integration_events").insert({ user_id: key.user_id, funnel_id: body.funnel_id ?? null, event_type: body.event_type, external_id: externalId, payload: body.payload ?? body, occurred_at: body.occurred_at ?? new Date().toISOString(), status: "received" }).select("id,event_type,external_id,status,created_at").single();
      if (error) return await respond({ ok: false, error: "event_rejected" }, 409, "events:write", "event_rejected");
      return await respond({ ok: true, data }, 202, "events:write");
    }

    return await respond({ ok: false, error: "not_found" }, 404, undefined, "not_found");
  } catch (e) {
    console.error(e);
    return await respond({ ok: false, error: "internal_error" }, 500, undefined, "internal_error");
  }
});
