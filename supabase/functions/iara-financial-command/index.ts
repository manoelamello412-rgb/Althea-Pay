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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_TOOL = "gateway.financial-command";
const CANONICAL_VERSION = 1;
const ROLES = new Set(["owner", "admin", "manager", "operator", "supervisor"]);
async function authenticatedUser(req: Request) { if (!url || !anon) return null; const a = req.headers.get("authorization"); if (!a) return null; const c = createClient(url, anon, { global: { headers: { Authorization: a } } }); const r = await c.auth.getUser(); return r.error ? null : r.data.user; }
async function failIdempotency(db: ReturnType<typeof createClient>, id: string) { await db.from("iara_execution_idempotency").update({ status: "FAILED", completed_at: new Date().toISOString(), error: "FINANCIAL_FEB_ISSUANCE_DENIED" }).eq("idempotency_id", id).eq("status", "RUNNING"); }

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
  try { const x = await req.json(); if (!rec(x)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); b = x; } catch { return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400); }
  const tenantId = text(b.tenant_id), gatewayId = text(b.gateway_id), action = actionOf(b.action);
  const headerIdempotency = text(req.headers.get("x-idempotency-key") ?? req.headers.get("idempotency-key"));
  const idempotencyKey = text(b.idempotency_key ?? headerIdempotency);
  const confirmationId = text(b.confirmation_id), evaluationId = text(b.evaluation_id), executionId = text(b.execution_id) || randomUUID();
  const toolKey = text(b.tool_key) || CANONICAL_TOOL, toolVersion = Number(b.tool_version || CANONICAL_VERSION), input = rec(b.input) ? b.input : {};
  if (!UUID.test(tenantId) || !UUID.test(gatewayId) || !UUID.test(executionId) || !action || !idempotencyKey || !confirmationId || !evaluationId || !Number.isInteger(toolVersion) || idempotencyKey.length > 300) return json({ ok: false, code: "COMMAND_INVALID", retryable: false }, 422);
  if (headerIdempotency && headerIdempotency !== idempotencyKey) return json({ ok: false, code: "IDEMPOTENCY_CONFLICT", reason: "HEADER_BODY_MISMATCH", retryable: false }, 409);
  if (toolKey !== CANONICAL_TOOL || toolVersion !== CANONICAL_VERSION) return json({ ok: false, code: "AUTHORIZATION_DENIED", reason: "NON_CANONICAL_FINANCIAL_TOOL", retryable: false }, 403);
  const amount = Number(input.amount), currency = text(input.currency).toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return json({ ok: false, code: "COMMAND_INVALID", reason: "INVALID_MONEY_COMMAND", retryable: false }, 422);
  const db = createClient(url, service);
  const member = await db.from("organization_members").select("role").eq("organization_id", tenantId).eq("user_id", u.id).maybeSingle();
  if (member.error || !member.data || !ROLES.has(String(member.data.role))) return json({ ok: false, code: "AUTHORIZATION_DENIED", retryable: false }, 403);
  const gateway = await db.from("gateways").select("id,user_id,status").eq("id", gatewayId).eq("user_id", u.id).maybeSingle();
  if (gateway.error || !gateway.data || !["connected", "degraded"].includes(String(gateway.data.status))) return json({ ok: false, code: "AUTHORIZATION_DENIED", reason: "GATEWAY_NOT_AUTHORIZED", retryable: false }, 403);
  const fingerprint = hash(JSON.stringify(stable({ tenant_id: tenantId, user_id: u.id, tool_key: toolKey, tool_version: toolVersion, gateway_id: gatewayId, action, idempotency_key: idempotencyKey, input })));
  let idem = await db.from("iara_execution_idempotency").insert({ tenant_id: tenantId, idempotency_key: idempotencyKey, tool_key: toolKey, tool_version: toolVersion, request_hash: fingerprint, execution_id: executionId, status: "RUNNING" }).select("idempotency_id").single();
  if (idem.error) {
    if (idem.error.code !== "23505") return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "IDEMPOTENCY_RESERVATION_FAILED", executionId, retryable: false }, 503);
    const existing = await db.from("iara_execution_idempotency").select("idempotency_id,request_hash,status,execution_id").eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing.error || !existing.data) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "IDEMPOTENCY_LOOKUP_FAILED", executionId, retryable: false }, 503);
    if (existing.data.request_hash !== fingerprint) return json({ ok: false, code: "IDEMPOTENCY_CONFLICT", reason: "REQUEST_FINGERPRINT_MISMATCH", executionId, retryable: false }, 409);
    return json({ ok: false, code: "IDEMPOTENCY_CONFLICT", reason: "FINANCIAL_FEB_ALREADY_RESERVED", executionId: existing.data.execution_id, retryable: false }, 409);
  }
  const idempotencyId = String(idem.data.idempotency_id);
  const confirmation = await db.from("iara_financial_confirmations").update({ consumed_at: new Date().toISOString() }).eq("confirmation_id", confirmationId).eq("user_id", u.id).eq("tenant_id", tenantId).eq("tool_key", toolKey).eq("tool_version", toolVersion).eq("gateway_id", gatewayId).eq("action", action).eq("idempotency_key", idempotencyKey).eq("request_fingerprint", fingerprint).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("confirmation_id").maybeSingle();
  if (confirmation.error || !confirmation.data) { await failIdempotency(db, idempotencyId); return json({ ok: false, code: "CONFIRMATION_REQUIRED", reason: "CONFIRMATION_INVALID_OR_CONSUMED", executionId, retryable: false }, 409); }
  const evaluation = await db.from("iara_evaluations").select("evaluation_id,tenant_id,execution_id,decision,grounding_score,evidence_coverage,data_confidence,tool_call_accuracy").eq("evaluation_id", evaluationId).eq("tenant_id", tenantId).eq("execution_id", executionId).maybeSingle();
  if (evaluation.error || !evaluation.data) { await failIdempotency(db, idempotencyId); return json({ ok: false, code: "GUARDRAIL_BLOCKED", reason: "EVALUATION_MISSING", executionId, retryable: false }, 403); }
  if (evaluation.data.decision !== "PASS" || Number(evaluation.data.grounding_score) < 0.9 || Number(evaluation.data.evidence_coverage) < 0.9 || Number(evaluation.data.data_confidence) < 0.9 || Number(evaluation.data.tool_call_accuracy) < 0.9) { await failIdempotency(db, idempotencyId); return json({ ok: false, code: "GUARDRAIL_BLOCKED", reason: "INDEPENDENT_EVALUATOR_NOT_PASS", executionId, retryable: false }, 403); }
  const now = Math.floor(Date.now() / 1000), maxAge = Math.min(Math.max(Number(Deno.env.get("ALTHEA_FEB_TICKET_MAX_SECONDS") || 60), 1), 60), exp = now + maxAge;
  const kid = Deno.env.get("ALTHEA_FEB_KID")?.trim(), aud = Deno.env.get("ALTHEA_FEB_AUDIENCE")?.trim();
  if (!kid || !aud) { await failIdempotency(db, idempotencyId); return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "FEB_KEY_METADATA_NOT_CONFIGURED", executionId, retryable: false }, 503); }
  const payload = { jti: randomUUID(), executionId, tenantId, userId: u.id, toolKey, toolVersion, gatewayId, action, idempotencyKey, requestFingerprint: fingerprint, issuedAt: now, expiresAt: exp, iat: now, exp, iss: issuer, aud };
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url"), head = enc({ alg: "RS256", kid, typ: "JWT" }), body = enc(payload), inputToSign = `${head}.${body}`;
  const signer = createSign("RSA-SHA256"); signer.update(inputToSign); signer.end(); const signature = signer.sign(createPrivateKey(key)).toString("base64url");
  const completion = await db.from("iara_execution_idempotency").update({ status: "COMPLETED", completed_at: new Date().toISOString(), result: { execution_id: executionId, jti: payload.jti, request_fingerprint: fingerprint } }).eq("idempotency_id", idempotencyId).eq("status", "RUNNING");
  if (completion.error) { await failIdempotency(db, idempotencyId); return json({ ok: false, code: "EXECUTION_UNAVAILABLE", reason: "IDEMPOTENCY_COMPLETION_FAILED", executionId, retryable: false }, 503); }
  return json({ ok: true, executionId, action, gatewayId, idempotencyKey, requestFingerprint: fingerprint, febTicket: `${inputToSign}.${signature}` });
});