import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const response = (body: Obj, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function safeProviderError(payload: unknown, fallback: string): string {
  if (isObj(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
    if (isObj(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (req.method !== "POST") return response({ ok: false, error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return response({ ok: false, error: "unauthorized" }, 401);
  const token = authorization.slice(7).trim();
  if (!token) return response({ ok: false, error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return response({ ok: false, error: "server_configuration_error" }, 500);

  const authClient = createClient(url, serviceRole, { auth: { persistSession: false } });
  const userResult = await authClient.auth.getUser(token);
  if (userResult.error || !userResult.data.user) return response({ ok: false, error: "unauthorized" }, 401);
  const userId = userResult.data.user.id;

  let body: Obj;
  try {
    const parsed = await req.json();
    if (!isObj(parsed)) return response({ ok: false, error: "invalid_json" }, 400);
    body = parsed;
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const gatewayId = text(body.gateway_id);
  if (!gatewayId) return response({ ok: false, error: "gateway_id_required" }, 422);

  const gatewayResult = await authClient
    .from("gateways")
    .select("id,user_id,provider,environment,status,credential_id")
    .eq("id", gatewayId)
    .eq("user_id", userId)
    .maybeSingle();
  if (gatewayResult.error || !gatewayResult.data) return response({ ok: false, error: "gateway_not_found" }, 404);

  const gateway = gatewayResult.data;
  if (!gateway.credential_id) return response({ ok: false, error: "provider_credential_missing" }, 422);

  const credentialResult = await authClient.rpc("resolve_gateway_credential_for_gateway", { p_gateway_id: gatewayId });
  if (credentialResult.error || !isObj(credentialResult.data)) return response({ ok: false, error: "provider_credential_missing" }, 422);

  const credential = credentialResult.data.credentials;
  if (!isObj(credential)) return response({ ok: false, error: "provider_credential_invalid" }, 422);
  const provider = text(gateway.provider).toLowerCase();
  const environment = text(gateway.environment).toLowerCase() === "sandbox" ? "sandbox" : "production";

  const registryResult = await authClient
    .from("gateway_provider_registry")
    .select("provider_key,display_name,operational,is_active,adapter_key,adapter_url")
    .eq("provider_key", provider)
    .eq("is_active", true)
    .maybeSingle();
  if (registryResult.error || !registryResult.data) return response({ ok: false, error: "provider_not_registered" }, 422);
  const registry = registryResult.data;
  if (registry.operational !== true) return response({ ok: false, error: "provider_adapter_not_operational", provider, operational: false }, 422);

  const started = performance.now();
  let checkUrl = "";
  let headers: Record<string, string> = {};

  if (provider === "stripe") {
    const secret = text(credential.secret_key ?? credential.api_key);
    if (!secret) return response({ ok: false, error: "provider_secret_key_missing" }, 422);
    checkUrl = "https://api.stripe.com/v1/balance";
    headers = { Authorization: `Basic ${btoa(`${secret}:`)}` };
  } else if (provider === "asaas") {
    const key = text(credential.api_key);
    if (!key) return response({ ok: false, error: "provider_api_key_missing" }, 422);
    checkUrl = `${environment === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3"}/myAccount`;
    headers = { Authorization: key };
  } else if (provider === "mercado_pago") {
    const tokenValue = text(credential.access_token ?? credential.api_key);
    if (!tokenValue) return response({ ok: false, error: "provider_access_token_missing" }, 422);
    checkUrl = "https://api.mercadopago.com/users/me";
    headers = { Authorization: `Bearer ${tokenValue}` };
  } else {
    const adapterUrl = text(registry.adapter_url);
    if (!/^https:\/\//i.test(adapterUrl)) return response({ ok: false, error: "provider_adapter_url_unavailable" }, 422);
    const adapterSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
    if (!adapterSecret) return response({ ok: false, error: "server_configuration_error" }, 500);
    const adapterResponse = await fetch(adapterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Althea-Internal-Secret": adapterSecret, "X-Althea-Gateway-Id": gatewayId },
      body: JSON.stringify({ operation: "health_check", provider, gateway_id: gatewayId, environment }),
    });
    const payload = await adapterResponse.json().catch(() => ({}));
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    if (!adapterResponse.ok || !isObj(payload) || payload.ok !== true) {
      await authClient.from("gateways").update({ status: "error" }).eq("id", gatewayId).eq("user_id", userId);
      return response({ ok: false, error: isObj(payload) ? safeProviderError(payload, "connection_test_failed") : "connection_test_failed", provider, latency_ms: latencyMs }, adapterResponse.status >= 400 ? adapterResponse.status : 502);
    }
    await authClient.from("gateways").update({ status: "connected" }).eq("id", gatewayId).eq("user_id", userId);
    return response({ ok: true, provider, environment, latency_ms: latencyMs, status: "connected" });
  }

  try {
    const providerResponse = await fetch(checkUrl, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    const payload = await providerResponse.json().catch(() => ({}));
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const ok = providerResponse.ok;
    await authClient.from("gateways").update({ status: ok ? "connected" : "error" }).eq("id", gatewayId).eq("user_id", userId);
    if (!ok) return response({ ok: false, error: safeProviderError(payload, "connection_test_failed"), provider, environment, latency_ms: latencyMs }, 502);
    return response({ ok: true, provider, environment, latency_ms: latencyMs, status: "connected" });
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await authClient.from("gateways").update({ status: "error" }).eq("id", gatewayId).eq("user_id", userId);
    return response({ ok: false, error: error instanceof Error ? error.message : "connection_test_failed", provider, environment, latency_ms: latencyMs }, 502);
  }
});
