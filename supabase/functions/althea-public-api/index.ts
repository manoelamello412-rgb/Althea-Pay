import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-althea-api-key, x-api-key, x-request-id", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200, extra: Record<string,string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
const requestId = (r: Request) => r.headers.get("x-request-id") || crypto.randomUUID();
const scopeOk = (s: unknown, required: string) => Array.isArray(s) && (s.includes("*") || s.includes(required));
const limitOf = (v: string | null) => Math.min(100, Math.max(1, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 50));

async function log(userId: string, keyId: string, rid: string, req: Request, status: number, started: number, scope?: string, errorCode?: string) {
  await admin.from("api_request_logs").insert({ user_id: userId, api_key_id: keyId, request_id: rid, method: req.method, path: new URL(req.url).pathname, status_code: status, latency_ms: Math.round(performance.now() - started), scope: scope ?? null, error_code: errorCode ?? null, user_agent: req.headers.get("user-agent") });
}

async function auth(req: Request) {
  const key = req.headers.get("x-althea-api-key") || req.headers.get("x-api-key") || req.headers.get("apikey") || (req.headers.get("authorization")?.startsWith("Bearer althea_") ? req.headers.get("authorization")!.slice(7) : null);
  if (!key) return { error: "missing_api_key" as const };
  const { data, error } = await admin.rpc("authenticate_althea_api_key", { p_key: key }).maybeSingle();
  if (error || !data) return { error: "invalid_api_key" as const };
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return { error: "expired_api_key" as const };
  const rate = await admin.rpc("consume_althea_api_rate_limit", { p_api_key_id: data.api_key_id, p_limit: 120 });
  if (rate.error) return { error: "rate_limit_unavailable" as const };
  const state = Array.isArray(rate.data) ? rate.data[0] : rate.data;
  if (!state?.allowed) return { error: "rate_limited" as const, state };
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.api_key_id);
  return { data, state };
}

Deno.serve(async (req) => {
  const rid = requestId(req), started = performance.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "server_not_configured", request_id: rid }, 500);
  const a = await auth(req);
  if ("error" in a) {
    const status = a.error === "rate_limited" ? 429 : a.error === "rate_limit_unavailable" ? 503 : 401;
    return json({ error: a.error, request_id: rid }, status, status === 429 ? { "Retry-After": "60" } : {});
  }
  const key = a.data, scopes = Array.isArray(key.scopes) ? key.scopes.map(String) : [];
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/althea-public-api\/?/, "").replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  const resource = parts[1], itemId = parts[2];
  const respond = async (body: unknown, status = 200, scope?: string, errorCode?: string) => { await log(key.user_id, key.api_key_id, rid, req, status, started, scope, errorCode); return json({ ...((body && typeof body === "object") ? body : { data: body }), request_id: rid }, status, { "X-Request-Id": rid, "X-RateLimit-Limit": "120", "X-RateLimit-Remaining": String(a.state?.remaining ?? 0) }); };
  try {
    if (parts[0] !== "v1" || !resource) return respond({ error: "not_found" }, 404, undefined, "not_found");
    if (req.method === "GET" && resource === "funnels") {
      if (!scopeOk(scopes, "funnels:read")) return respond({ error: "insufficient_scope" }, 403, "funnels:read", "insufficient_scope");
      let q = admin.from("funnels").select("id,nome,url,endpoint,status,created_at,last_communication").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(limitOf(url.searchParams.get("limit")));
      if (itemId) q = q.eq("id", itemId);
      const { data, error } = await q; if (error) return respond({ error: "database_error" }, 500, "funnels:read", "database_error"); if (itemId && !data?.length) return respond({ error: "funnel_not_found" }, 404, "funnels:read", "funnel_not_found");
      return respond({ data: itemId ? data[0] : data }, 200, "funnels:read");
    }
    if (req.method === "GET" && resource === "products") {
      if (!scopeOk(scopes, "products:read")) return respond({ error: "insufficient_scope" }, 403, "products:read", "insufficient_scope");
      let q = admin.from("products").select("id,data,created_at").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(limitOf(url.searchParams.get("limit")));
      if (itemId) q = q.eq("id", itemId);
      const { data, error } = await q; if (error) return respond({ error: "database_error" }, 500, "products:read", "database_error"); if (itemId && !data?.length) return respond({ error: "product_not_found" }, 404, "products:read", "product_not_found");
      return respond({ data: itemId ? data[0] : data }, 200, "products:read");
    }
    if (req.method === "GET" && resource === "sales") {
      if (!scopeOk(scopes, "sales:read")) return respond({ error: "insufficient_scope" }, 403, "sales:read", "insufficient_scope");
      let q = admin.from("sales").select("id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,created_at").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(limitOf(url.searchParams.get("limit")));
      if (url.searchParams.get("funnel_id")) q = q.eq("funnel_id", url.searchParams.get("funnel_id")!); if (url.searchParams.get("status")) q = q.eq("status", url.searchParams.get("status")!);
      const { data, error } = await q; if (error) return respond({ error: "database_error" }, 500, "sales:read", "database_error"); return respond({ data }, 200, "sales:read");
    }
    if (req.method === "GET" && resource === "transactions") {
      if (!scopeOk(scopes, "transactions:read")) return respond({ error: "insufficient_scope" }, 403, "transactions:read", "insufficient_scope");
      let q = admin.from("gateway_transactions").select("id,funnel_id,product_id,gateway_id,external_id,idempotency_key,amount,currency,status,customer,metadata,error_message,created_at,updated_at,attempt_count,completed_at,failure_code,routing_metadata").eq("user_id", key.user_id).order("created_at", { ascending: false }).limit(limitOf(url.searchParams.get("limit")));
      if (url.searchParams.get("funnel_id")) q = q.eq("funnel_id", url.searchParams.get("funnel_id")!); if (url.searchParams.get("status")) q = q.eq("status", url.searchParams.get("status")!);
      const { data, error } = await q; if (error) return respond({ error: "database_error" }, 500, "transactions:read", "database_error"); return respond({ data }, 200, "transactions:read");
    }
    if (req.method === "POST" && resource === "events") {
      if (!scopeOk(scopes, "events:write")) return respond({ error: "insufficient_scope" }, 403, "events:write", "insufficient_scope");
      const body = await req.json().catch(() => null) as Record<string,unknown> | null; const type = typeof body?.event_type === "string" ? body.event_type.trim().slice(0,120) : ""; const externalId = typeof body?.external_id === "string" ? body.external_id.trim().slice(0,255) : null;
      if (!type) return respond({ error: "invalid_event" }, 400, "events:write", "invalid_event");
      if (externalId) { const { data: existing } = await admin.from("integration_events").select("id,event_type,external_id,status,created_at").eq("user_id", key.user_id).eq("external_id", externalId).maybeSingle(); if (existing) return respond({ duplicate: true, data: existing }, 200, "events:write"); }
      const { data, error } = await admin.from("integration_events").insert({ user_id: key.user_id, funnel_id: typeof body?.funnel_id === "string" ? body.funnel_id : null, event_type: type, external_id: externalId, status: "received", payload: body?.payload && typeof body.payload === "object" ? body.payload : body, occurred_at: typeof body?.occurred_at === "string" ? body.occurred_at : new Date().toISOString() }).select("id,event_type,external_id,status,occurred_at,created_at").single();
      if (error) return respond({ error: error.code === "23505" ? "duplicate_event" : "event_rejected" }, error.code === "23505" ? 200 : 400, "events:write", error.code === "23505" ? undefined : "event_rejected"); return respond({ accepted: true, data }, 202, "events:write");
    }
    return respond({ error: "not_found" }, 404, undefined, "not_found");
  } catch { return respond({ error: "internal_error" }, 500, undefined, "internal_error"); }
});
