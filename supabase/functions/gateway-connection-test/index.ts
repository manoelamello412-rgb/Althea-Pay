import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const providerError = (payload: unknown, fallback: string): string => {
  if (!isObject(payload)) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (isObject(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return fallback;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return response({ ok: false, error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return response({ ok: false, error: "unauthorized" }, 401);
  const token = authorization.slice(7).trim();
  if (!token) return response({ ok: false, error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return response({ ok: false, error: "server_configuration_error" }, 500);

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const userResult = await db.auth.getUser(token);
  if (userResult.error || !userResult.data.user) return response({ ok: false, error: "unauthorized" }, 401);
  const userId = userResult.data.user.id;
  const internalResult = await db.rpc("get_althea_internal_secret");
  if (internalResult.error || typeof internalResult.data !== "string" || !internalResult.data) return response({ ok: false, error: "internal_auth_unavailable" }, 500);
  const internalSecret = internalResult.data;

  let body: JsonObject;
  try {
    const parsed = await request.json();
    if (!isObject(parsed)) return response({ ok: false, error: "invalid_json" }, 400);
    body = parsed;
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const gatewayId = text(body.gateway_id);
  if (!gatewayId) return response({ ok: false, error: "gateway_id_required" }, 422);

  const gatewayResult = await db
    .from("gateways")
    .select("id,user_id,provider,environment,status,credential_id,circuit_id")
    .eq("id", gatewayId)
    .eq("user_id", userId)
    .maybeSingle();
  if (gatewayResult.error || !gatewayResult.data) return response({ ok: false, error: "gateway_not_found" }, 404);
  if (!gatewayResult.data.credential_id) return response({ ok: false, error: "provider_credential_missing" }, 422);

  const registryResult = await db
    .from("gateway_provider_registry")
    .select("provider_key,display_name,operational,is_active,adapter_key,adapter_url")
    .eq("provider_key", text(gatewayResult.data.provider).toLowerCase())
    .eq("is_active", true)
    .maybeSingle();
  if (registryResult.error || !registryResult.data) return response({ ok: false, error: "provider_not_registered" }, 422);
  if (registryResult.data.operational !== true) return response({ ok: false, error: "provider_adapter_not_operational" }, 422);

  const environment = text(gatewayResult.data.environment).toLowerCase() === "sandbox" ? "sandbox" : "production";
  const adapterUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/gateway-provider-adapter`;
  const recordHealth = async (success: boolean, latencyMs: number) => {
    const circuitId = text(gatewayResult.data.circuit_id);
    if (!circuitId) return;
    const health = await db.rpc("record_gateway_health", {
      p_gateway_id: circuitId,
      p_gateway_name: text(gatewayResult.data.provider).toLowerCase(),
      p_success: success,
      p_latency_ms: latencyMs,
    });
    if (health.error) console.error("gateway_connection_test.health_record_failed", {
      gateway_id: gatewayId,
      code: health.error.code,
    });
  };
  const started = performance.now();

  try {
    const adapterResponse = await fetch(adapterUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Althea-Internal-Secret": internalSecret,
        "X-Althea-Gateway-Id": gatewayId,
      },
      body: JSON.stringify({
        operation: "health_check",
        gateway_id: gatewayId,
        provider: text(gatewayResult.data.provider).toLowerCase(),
        environment,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = await adapterResponse.json().catch(() => ({}));
    if (!adapterResponse.ok || !isObject(payload) || payload.ok !== true) {
      const message = providerError(payload, "connection_test_failed");
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      await recordHealth(false, latencyMs);
      await db.from("gateways").update({ status: "error" }).eq("id", gatewayId).eq("user_id", userId);
      return response({
        ok: false,
        error: message,
        provider: gatewayResult.data.provider,
        environment,
        latency_ms: latencyMs,
      }, adapterResponse.status >= 400 ? 502 : 500);
    }

    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await recordHealth(true, latencyMs);
    const update = await db.from("gateways").update({ status: "connected" }).eq("id", gatewayId).eq("user_id", userId);
    if (update.error) return response({ ok: false, error: "gateway_status_update_failed", provider: gatewayResult.data.provider, environment, latency_ms: latencyMs }, 500);

    return response({
      ok: true,
      provider: gatewayResult.data.provider,
      environment,
      latency_ms: latencyMs,
      status: "connected",
    });
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await recordHealth(false, latencyMs);
    await db.from("gateways").update({ status: "error" }).eq("id", gatewayId).eq("user_id", userId);
    const message = error instanceof Error ? error.message : "connection_test_failed";
    return response({
      ok: false,
      error: message.startsWith("target_not_allowed") ? "target_not_allowed" : message,
      provider: gatewayResult.data.provider,
      environment,
      latency_ms: latencyMs,
    }, 502);
  }
});
