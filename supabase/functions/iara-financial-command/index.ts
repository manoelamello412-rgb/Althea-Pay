import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash, createPrivateKey, createSign, randomUUID } from "node:crypto";

type O = Record<string, unknown>;
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,x-idempotency-key,idempotency-key", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: H });
const rec = (v: unknown): v is O => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : !rec(v) ? v : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const actionOf = (v: unknown) => { const a = text(v).toLowerCase(); return ["purchase", "refund", "capture", "void"].includes(a) ? a : null; };
async function authenticatedUser(req: Request) { if (!url || !anon) return null; const a = req.headers.get("authorization"); if (!a) return null; const c = createClient(url, anon, { global: { headers: { Authorization: a } } }); const r = await c.auth.getUser(); return r.error ? null : r.data.user; }

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", retryable: false }, 405);
  const u = await authenticatedUser(req);
  if (!u) return json({ ok: false, code: "UNAUTHORIZED", retryable: false }, 401);
  if (!service) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "SERVICE_ROLE_NOT_CONFIGURED", retryable: false }, 503);
  const key = Deno.env.get("ALTHEA_FEB_PRIVATE_KEY")?.trim();
  const issuer = Deno.env.get("ALTHEA_FEB_ISSUER")?.trim();
  if (!key || !issuer) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "FEB_ISSUER_NOT_CONFIGURED", retryable: false }, 503);

  let b: O;
  try { const x = await req.json(); if (!rec(x)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); b = x; }
  catch { return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); }

  const tenantId = text(b.tenant_id), gatewayId = text(b.gateway_id), action = actionOf(b.action);
  const idempotencyKey = text(b.idempotency_key ?? req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key"));
  const confirmationId = text(b.confirmation_id), evaluationId = text(b.evaluation_id), executionId = text(b.execution_id) || randomUUID();
  const toolKey = text(b.tool_key) || "gateway.financial-command", toolVersion = Number(b.tool_version || 1);
  const input = rec(b.input) ? b.input : {};
  if (!tenantId || !gatewayId || !action || !idempotencyKey || !confirmationId || !evaluationId || !Number.isInteger(toolVersion) || toolVersion < 1 || idempotencyKey.length > 300) return json({ ok: false, code: "COMMAND_INVALID", retryable: false }, 422);

  const db = createClient(url, service);
  const member = await db.from("organization_members").select("role").eq("organization_id", tenantId).eq("user_id", u.id).maybeSingle();
  if (member.error || !member.data || !["owner", "admin", "manager", "operator", "supervisor"].includes(member.data.role)) return json({ ok: false, code: "AUTHORIZATION_DENIED", retryable: false }, 403);

  const gateway = await db.from("gateways").select("id,user_id,status").eq("id", gatewayId).eq("user_id", u.id).maybeSingle();
  if (gateway.error || !gateway.data || !["connected", "degraded"].includes(gateway.data.status)) return json({ ok: false, code: "AUTHORIZATION_DENIED", reason: "GATEWAY_NOT_AUTHORIZED", retryable: false }, 403);

  const fingerprint = hash(JSON.stringify(stable({ tenant_id: tenantId, user_id: u.id, tool_key: toolKey, tool_version: toolVersion, gateway_id: gatewayId, action, idempotency_key: idempotencyKey, input })));
  const confirmation = await db.from("iara_financial_confirmations").update({ consumed_at: new Date().toISOString() }).eq("confirmation_id", confirmationId).eq("user_id", u.id).eq("tenant_id", tenantId).eq("tool_key", toolKey).eq("tool_version", toolVersion).eq("gateway_id", gatewayId).eq("action", action).eq("idempotency_key", idempotencyKey).eq("request_fingerprint", fingerprint).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("confirmation_id").maybeSingle();
  if (confirmation.error || !confirmation.data) return json({ ok: false, code: "CONFIRMATION_REQUIRED", reason: "CONFIRMATION_INVALID_OR_CONSUMED", executionId, retryable: false }, 409);

  const evaluation = await db.from("iara_evaluations").select("evaluation_id,tenant_id,execution_id,decision,grounding_score,evidence_coverage,data_confidence,tool_call_accuracy").eq("evaluation_id", evaluationId).eq("tenant_id", tenantId).eq("execution_id", executionId).maybeSingle();
  if (evaluation.error || !evaluation.data) return json({ ok: false, code: "GUARDRAIL_BLOCKED", reason: "EVALUATION_MISSING", executionId, retryable: false }, 403);
  if (evaluation.data.decision !== "PASS" || Number(evaluation.data.grounding_score) < 0.9 || Number(evaluation.data.evidence_coverage) < 0.9 || Number(evaluation.data.data_confidence) < 0.9 || Number(evaluation.data.tool_call_accuracy) < 0.9) return json({ ok: false, code: "GUARDRAIL_BLOCKED", reason: "INDEPENDENT_EVALUATOR_NOT_PASS", executionId, retryable: false }, 403);

  const now = Math.floor(Date.now() / 1000);
  const maxAge = Math.min(Math.max(Number(Deno.env.get("ALTHEA_FEB_TICKET_MAX_SECONDS") || 60), 1), 60);
  const exp = now + maxAge;
  const kid = Deno.env.get("ALTHEA_FEB_KID")?.trim();
  const aud = Deno.env.get("ALTHEA_FEB_AUDIENCE")?.trim();
  if (!kid || !aud) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "FEB_KEY_METADATA_NOT_CONFIGURED", executionId, retryable: false }, 503);

  const payload = { jti: randomUUID(), executionId, tenantId, userId: u.id, toolKey, toolVersion, gatewayId, action, idempotencyKey, requestFingerprint: fingerprint, issuedAt: now, expiresAt: exp, iat: now, exp, iss: issuer, aud };
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const head = enc({ alg: "RS256", kid, typ: "JWT" }), body = enc(payload), inputToSign = `${head}.${body}`;
  const signer = createSign("RSA-SHA256"); signer.update(inputToSign); signer.end();
  const signature = signer.sign(createPrivateKey(key)).toString("base64url");
  return json({ ok: true, executionId, action, gatewayId, idempotencyKey, requestFingerprint: fingerprint, febTicket: `${inputToSign}.${signature}` });
});
