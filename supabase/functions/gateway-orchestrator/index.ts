import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { validateFEB } from "../_shared/iara-feb-validator.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key, idempotency-key, x-althea-feb-ticket-signature",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function authenticate(req: Request, url: string, anonKey: string) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", retryable: false }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internal = Deno.env.get("ALTHEA_INTERNAL_SECRET");
  if (!url || !anon || !service || !internal) return json({ ok: false, code: "EXECUTION_UNAVAILABLE", retryable: false }, 503);

  const user = await authenticate(req, url, anon);
  if (!user) return json({ ok: false, code: "UNAUTHORIZED", retryable: false }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.clone().json();
    if (!record(parsed)) return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400);
    body = parsed;
  } catch {
    return json({ ok: false, code: "INVALID_JSON", retryable: false }, 400);
  }

  const operation = text(body.operation || "create_payment").toLowerCase();
  const action = operation === "refund" ? "refund" : operation === "capture" ? "capture" : operation === "void" ? "void" : "purchase";
  const tenantId = text(body.tenant_id);
  if (!tenantId || tenantId !== user.id) return json({ ok: false, code: "TICKET_IDENTITY_MISMATCH", retryable: false }, 403);

  const feb = await validateFEB({ request: req, body, userId: user.id, tenantId, action });
  if (!feb.ok) return json({ ok: false, code: feb.code, retryable: false }, feb.status);

  const internalRequest = new Request(req.url, {
    method: "POST",
    headers: new Headers(req.headers),
    body: JSON.stringify(body),
  });
  internalRequest.headers.set("x-althea-internal-secret", internal);
  internalRequest.headers.set("x-althea-feb-ticket-signature", feb.token);

  const runtimeUrl = `${url.replace(/\/$/, "")}/functions/v1/gateway-orchestrator-runtime`;
  const response = await fetch(runtimeUrl, {
    method: "POST",
    headers: internalRequest.headers,
    body: await internalRequest.text(),
  });
  const payload = await response.json().catch(() => ({ ok: false, code: "EXECUTION_UNAVAILABLE", retryable: false }));
  return json(payload, response.status);
});
