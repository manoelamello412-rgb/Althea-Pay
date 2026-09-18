import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";

type Json = Record<string, unknown>;
type Operation = "health_check" | "get_gateway" | "set_gateway";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,apikey",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const adminKeyFromEnv = (): string => {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = typeof parsed.default === "string" ? parsed.default.trim() : "";
      if (key) return key;
    } catch {
      // Fall through to the legacy key while the project migrates key formats.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
};

const getPath = (value: unknown, path: string): unknown => {
  let current = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
};

const interpolate = (value: unknown, context: Json): unknown => {
  if (Array.isArray(value)) return value.map((item) => interpolate(item, context));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, context)]),
    );
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exact) return getPath(context, exact[1].trim()) ?? null;

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path) => {
    const resolved = getPath(context, String(path).trim());
    return resolved == null ? "" : String(resolved);
  });
};

const method = (value: unknown, fallback: string): string => {
  const candidate = (text(value) || fallback).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(candidate)) {
    throw new Error("funnel_http_method_invalid");
  }
  return candidate;
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const parseJson = async (response: Response): Promise<Json> => {
  const value = await response.json().catch(() => ({}));
  return isObject(value) ? value : {};
};

const errorMessage = (payload: Json, fallback: string): string => {
  if (typeof payload.error === "string") return payload.error;
  if (isObject(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload.message === "string") return payload.message;
  return fallback;
};

const safeHeaders = (credential: Json, context: Json): Record<string, string> => {
  const headers: Record<string, string> = { Accept: "application/json" };
  const blocked = new Set([
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "x-althea-internal-secret",
    "x-forwarded-for",
    "forwarded",
  ]);

  const token = text(
    credential.token ??
      credential.api_key ??
      credential.access_token ??
      credential.secret_key,
  );
  if (token) {
    const headerName = text(credential.auth_header) || "Authorization";
    if (blocked.has(headerName.toLowerCase())) throw new Error("funnel_auth_header_forbidden");
    const prefix = credential.auth_prefix === "" ? "" : text(credential.auth_prefix) || "Bearer";
    headers[headerName] = prefix ? `${prefix} ${token}` : token;
  }

  const custom = isObject(credential.custom_headers) ? credential.custom_headers : {};
  for (const [name, rawValue] of Object.entries(custom)) {
    if (
      blocked.has(name.toLowerCase()) ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    ) {
      throw new Error("funnel_header_invalid");
    }
    const resolved = interpolate(rawValue, context);
    if (!["string", "number", "boolean"].includes(typeof resolved)) {
      throw new Error("funnel_header_value_invalid");
    }
    headers[name] = String(resolved);
  }

  return headers;
};

async function buildTarget(
  rawBaseUrl: string,
  rawPath: string,
  context: Json,
): Promise<string> {
  const checkedBase = await assertPublicHttpsUrl(rawBaseUrl);
  if (!checkedBase.ok) throw new Error(`target_not_allowed:${checkedBase.reason}`);

  const base = new URL(checkedBase.url);
  const renderedPath = String(interpolate(rawPath, context) ?? "");
  if (!renderedPath) throw new Error("funnel_endpoint_path_missing");

  const target = new URL(renderedPath, base);
  if (target.origin !== base.origin) throw new Error("funnel_endpoint_origin_mismatch");

  const checkedTarget = await assertPublicHttpsUrl(target.toString());
  if (!checkedTarget.ok) throw new Error(`target_not_allowed:${checkedTarget.reason}`);
  return checkedTarget.url;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = adminKeyFromEnv();
  if (!supabaseUrl || !adminKey) {
    return json({ ok: false, error: "server_configuration_error" }, 500);
  }

  const suppliedAdminKey = request.headers.get("apikey") ?? "";
  if (!constantTimeEqual(adminKey, suppliedAdminKey)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Json;
  try {
    const parsed = await request.json();
    if (!isObject(parsed)) return json({ ok: false, error: "invalid_json" }, 400);
    body = parsed;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const connectionId = text(body.connection_id);
  const operation = text(body.operation).toLowerCase() as Operation;
  const targetRemoteGatewayRef = text(body.target_remote_gateway_ref);
  const commandIdempotencyKey = text(body.idempotency_key).slice(0, 200);

  if (!connectionId) return json({ ok: false, error: "connection_id_required" }, 422);
  if (!["health_check", "get_gateway", "set_gateway"].includes(operation)) {
    return json({ ok: false, error: "operation_not_supported" }, 422);
  }
  if (operation === "set_gateway" && !targetRemoteGatewayRef) {
    return json({ ok: false, error: "target_remote_gateway_ref_required" }, 422);
  }

  const db = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const connectionResult = await db
    .from("funnel_connections")
    .select(
      "id,organization_id,funnel_id,status,adapter_key,remote_base_url,remote_funnel_id,capabilities,write_enabled,control_status,config,credential_secret_id",
    )
    .eq("id", connectionId)
    .maybeSingle();

  if (connectionResult.error) {
    console.error("funnel_adapter.connection_lookup_failed", {
      connection_id: connectionId,
      code: connectionResult.error.code,
    });
    return json({ ok: false, error: "connection_lookup_failed" }, 500);
  }
  const connection = connectionResult.data;
  if (!connection) return json({ ok: false, error: "connection_not_found" }, 404);
  if (connection.status !== "active") {
    return json({ ok: false, error: "connection_not_active" }, 422);
  }

  const capabilities = Array.isArray(connection.capabilities)
    ? connection.capabilities.map(String)
    : [];
  if (
    (operation === "get_gateway" || operation === "set_gateway") &&
    !capabilities.includes("gateway:read")
  ) {
    return json({ ok: false, error: "gateway_read_unsupported" }, 422);
  }
  if (
    operation === "set_gateway" &&
    (!connection.write_enabled || !capabilities.includes("gateway:write"))
  ) {
    return json({ ok: false, error: "gateway_write_unsupported" }, 422);
  }

  if (text(connection.adapter_key) !== "generic_http_json") {
    return json({ ok: false, error: "funnel_adapter_not_supported" }, 422);
  }

  const config = isObject(connection.config) ? connection.config : {};
  const remoteControl = isObject(config.remote_control) ? config.remote_control : {};
  const credentialResult = await db.rpc("resolve_funnel_connection_secret", {
    p_connection_id: connectionId,
  });
  if (credentialResult.error) {
    console.error("funnel_adapter.credential_resolution_failed", {
      connection_id: connectionId,
      code: credentialResult.error.code,
    });
    return json({ ok: false, error: "connection_credential_unavailable" }, 422);
  }
  const credential = isObject(credentialResult.data) ? credentialResult.data : {};

  const context: Json = {
    connection_id: connection.id,
    funnel_id: connection.funnel_id,
    remote_funnel_id: connection.remote_funnel_id,
    target_remote_gateway_ref: targetRemoteGatewayRef || null,
    idempotency_key: commandIdempotencyKey || null,
  };

  try {
    const rawBaseUrl = text(connection.remote_base_url);
    if (!rawBaseUrl) throw new Error("remote_base_url_missing");

    const gatewayGetPath =
      text(remoteControl.gateway_get_path) || "/funnels/{{remote_funnel_id}}/gateway";
    const gatewaySetPath = text(remoteControl.gateway_set_path) || gatewayGetPath;
    const healthPath = text(remoteControl.health_path) || gatewayGetPath;

    const selectedPath =
      operation === "health_check"
        ? healthPath
        : operation === "set_gateway"
        ? gatewaySetPath
        : gatewayGetPath;

    const targetUrl = await buildTarget(rawBaseUrl, selectedPath, context);
    const selectedMethod =
      operation === "health_check"
        ? method(remoteControl.health_method, "GET")
        : operation === "set_gateway"
        ? method(remoteControl.gateway_set_method, "PATCH")
        : method(remoteControl.gateway_get_method, "GET");

    const headers = safeHeaders(credential, context);
    if (commandIdempotencyKey) {
      const idempotencyHeader = text(remoteControl.idempotency_header) || "Idempotency-Key";
      if (!headers[idempotencyHeader]) headers[idempotencyHeader] = commandIdempotencyKey;
    }

    const timeoutRaw = Number(remoteControl.timeout_ms ?? 15_000);
    const timeoutMs = Math.min(Math.max(Number.isFinite(timeoutRaw) ? timeoutRaw : 15_000, 1_000), 30_000);

    const init: RequestInit = {
      method: selectedMethod,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (operation === "set_gateway" && !["GET", "DELETE"].includes(selectedMethod)) {
      const template = isObject(remoteControl.gateway_set_body)
        ? remoteControl.gateway_set_body
        : { gateway_id: "{{target_remote_gateway_ref}}" };
      init.body = JSON.stringify(interpolate(template, context));
      headers["Content-Type"] = "application/json";
    }

    const startedAt = performance.now();
    const externalResponse = await fetch(targetUrl, init);
    const payload = await parseJson(externalResponse);
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (!externalResponse.ok) {
      return json(
        {
          ok: false,
          error: errorMessage(payload, `funnel_http_${externalResponse.status}`),
          failure_code: `http_${externalResponse.status}`,
          retryable:
            externalResponse.status === 408 ||
            externalResponse.status === 425 ||
            externalResponse.status === 429 ||
            externalResponse.status >= 500,
          latency_ms: latencyMs,
        },
        externalResponse.status >= 500 ? 502 : 422,
      );
    }

    const gatewayResponsePath =
      text(remoteControl.gateway_response_path) || "gateway_id";
    const observedValue = getPath(payload, gatewayResponsePath);
    const observedRemoteGatewayRef =
      observedValue == null ? "" : String(observedValue).trim();

    if (operation !== "health_check" && !observedRemoteGatewayRef) {
      return json(
        {
          ok: false,
          error: "remote_gateway_reference_missing",
          failure_code: "response_mapping_invalid",
          retryable: false,
          latency_ms: latencyMs,
        },
        422,
      );
    }

    return json({
      ok: true,
      operation,
      connection_id: connection.id,
      observed_remote_gateway_ref: observedRemoteGatewayRef || null,
      latency_ms: latencyMs,
      response: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "funnel_adapter_error";
    const retryable =
      error instanceof DOMException ||
      /timeout|network|temporarily|connection/i.test(message);
    return json(
      {
        ok: false,
        error: message.startsWith("target_not_allowed") ||
          message === "funnel_endpoint_origin_mismatch"
          ? "target_not_allowed"
          : message,
        retryable,
      },
      retryable ? 502 : 422,
    );
  }
});
