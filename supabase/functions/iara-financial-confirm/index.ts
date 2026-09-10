import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, randomUUID } from "node:crypto";

type O = Record<string, unknown>;
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: H });
const rec = (v: unknown): v is O => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : !rec(v) ? v : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

async function user(req: Request) {
  if (!url || !anon) return null;
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", retryable: false }, 405);
  const currentUser = await user(req);
  if (!currentUser) return json({ ok: false, code: "UNAUTHORIZED", retryable: false }, 401);
  if (!service) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "SERVICE_ROLE_NOT_CONFIGURED", retryable: false }, 503);

  let body: O;
  try { const parsed = await req.json(); if (!rec(parsed)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); body = parsed; }
  catch { return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); }

  if (body.confirmed !== true) return json({ ok: false, code: "CONFIRMATION_REQUIRED", retryable: false }, 409);
  const tenantId = text(body.tenant_id), gatewayId = text(body.gateway_id), toolKey = text(body.tool_key), idempotencyKey = text(body.idempotency_key), action = text(body.action).toLowerCase();
  const toolVersion = Number(body.tool_version);
  const executionId = text(body.execution_id);
  const input = rec(body.input) ? body.input : {};
  if (!tenantId || !gatewayId || !toolKey || !idempotencyKey || !executionId || !Number.isInteger(toolVersion) || toolVersion < 1 || !["purchase","capture","refund","void"].includes(action)) return json({ ok: false, code: "COMMAND_INVALID", retryable: false }, 422);

  const db = createClient(url, service);
  const membership = await db.from("organization_members").select("user_id").eq("organization_id", tenantId).eq("user_id", currentUser.id).maybeSingle();
  if (membership.error || !membership.data) return json({ ok: false, code: "AUTHORIZATION_DENIED", retryable: false }, 403);
  const fingerprint = hash(JSON.stringify(stable({ tenant_id: tenantId, user_id: currentUser.id, tool_key: toolKey, tool_version: toolVersion, gateway_id: gatewayId, action, idempotency_key: idempotencyKey, input })));
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const confirmationId = randomUUID();
  const inserted = await db.from("iara_financial_confirmations").insert({ confirmation_id: confirmationId, user_id: currentUser.id, tenant_id: tenantId, tool_key: toolKey, tool_version: toolVersion, gateway_id: gatewayId, action, idempotency_key: idempotencyKey, request_fingerprint: fingerprint, expires_at: expiresAt });
  if (inserted.error) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", retryable: false }, 503);
  return json({ ok: true, confirmation_id: confirmationId, execution_id: executionId, request_fingerprint: fingerprint, expires_at: expiresAt });
});
