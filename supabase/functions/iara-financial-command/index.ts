import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, createPrivateKey, createSign, randomUUID } from "node:crypto";

type O = Record<string, unknown>;
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,x-idempotency-key,idempotency-key" };
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: H });
const rec = (v: unknown): v is O => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : !rec(v) ? v : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const actionOf = (v: unknown) => ["purchase", "refund", "capture", "void"].includes(text(v).toLowerCase()) ? text(v).toLowerCase() : null;

async function authenticatedUser(req: Request) {
  if (!url || !anon) return null;
  const a = req.headers.get("authorization");
  if (!a) return null;
  const c = createClient(url, anon, { global: { headers: { Authorization: a } } });
  const r = await c.auth.getUser();
  return r.error ? null : r.data.user;
}

async function isMember(userId: string, tenantId: string) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !service || !tenantId) return false;
  const db = createClient(url, service);
  const { data, error } = await db.from("organization_members").select("user_id").eq("organization_id", tenantId).eq("user_id", userId).maybeSingle();
  return !error && !!data;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", retryable: false }, 405);
  const u = await authenticatedUser(req);
  if (!u) return json({ ok: false, code: "UNAUTHORIZED", retryable: false }, 401);
  const key = Deno.env.get("ALTHEA_FEB_PRIVATE_KEY")?.trim();
  const issuer = Deno.env.get("ALTHEA_FEB_ISSUER")?.trim();
  if (!key || !issuer) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "FEB_ISSUER_NOT_CONFIGURED", retryable: false }, 503);
  let b: O;
  try { const x = await req.json(); if (!rec(x)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); b = x; }
  catch { return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); }
  const gatewayId = text(b.gateway_id);
  const action = actionOf(b.action);
  const idempotencyKey = text(b.idempotency_key ?? req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key"));
  const tenantId = text(b.tenant_id);
  if (!gatewayId || !action || !idempotencyKey || !tenantId || idempotencyKey.length > 300) return json({ ok: false, code: "COMMAND_INVALID", retryable: false }, 422);
  if (!(await isMember(u.id, tenantId))) return json({ ok: false, code: "AUTHORIZATION_DENIED", retryable: false }, 403);
  const input = rec(b.input) ? b.input : b;
  const executionId = text(b.execution_id) || randomUUID();
  const toolKey = text(b.tool_key) || "gateway.financial-command";
  const toolVersion = Number(b.tool_version || 1);
  if (!Number.isInteger(toolVersion) || toolVersion < 1) return json({ ok: false, code: "COMMAND_INVALID", retryable: false }, 422);
  const fp = hash(JSON.stringify(stable({ tenant_id: tenantId, user_id: u.id, tool_key: toolKey, tool_version: toolVersion, gateway_id: gatewayId, action, idempotency_key: idempotencyKey, input })));
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(Number(Deno.env.get("ALTHEA_FEB_TICKET_MAX_SECONDS") || 60), 1), 60);
  const exp = now + ttl;
  const kid = Deno.env.get("ALTHEA_FEB_KID") || "althea-feb-2026-09-10-k1";
  const aud = Deno.env.get("ALTHEA_FEB_AUDIENCE") || "althea-pay:gateway-orchestrator";
  const payload = { jti: randomUUID(), executionId, tenantId, userId: u.id, toolKey, toolVersion, gatewayId, action, idempotencyKey, requestFingerprint: fp, issuedAt: now, expiresAt: exp, iat: now, exp, iss: issuer, aud, issuer, audience: aud, kid };
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc(payload);
  const inputToSign = `${head}.${body}`;
  const s = createSign("RSA-SHA256"); s.update(inputToSign); s.end();
  const sig = s.sign(createPrivateKey(key)).toString("base64url");
  return json({ ok: true, executionId, action, gatewayId, idempotencyKey, febTicket: `${inputToSign}.${sig}` });
});
