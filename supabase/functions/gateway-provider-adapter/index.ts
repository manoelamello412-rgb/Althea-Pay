import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";

type JsonObject = Record<string, unknown>;

type Operation =
  | "create_payment"
  | "payment_status"
  | "retrieve_payment"
  | "retrieve"
  | "status"
  | "refund"
  | "health_check";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-althea-internal-secret,x-gateway-id,x-althea-gateway-id,x-althea-idempotency-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const getPath = (value: unknown, path: string): unknown => {
  let current: unknown = value;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const firstString = (value: JsonObject, paths: string[], fallback = ""): string => {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return fallback;
};

const parseJson = async (result: Response): Promise<JsonObject> => {
  const payload = await result.json().catch(() => ({}));
  return isObject(payload) ? payload : {};
};

const providerError = (payload: JsonObject, fallback: string): string => {
  if (typeof payload.error === "string") return payload.error;
  if (isObject(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  if (Array.isArray(payload.errors) && isObject(payload.errors[0])) {
    const firstError = payload.errors[0];
    if (typeof firstError.description === "string") return firstError.description;
    if (typeof firstError.message === "string") return firstError.message;
  }
  return fallback;
};

const normalizeStatus = (rawStatus: string, configuredMap: JsonObject): string => {
  const status = rawStatus.trim().toLowerCase();
  const configured = configuredMap[status];
  if (typeof configured === "string" && configured.trim()) return configured.trim().toLowerCase();

  if (["approved", "authorized", "succeeded", "success", "paid", "completed", "complete", "captured", "received", "confirmed"].includes(status)) return "approved";
  if (["pending", "processing", "in_process", "in_analysis", "requires_action", "requires_confirmation", "created", "waiting"].includes(status)) return "pending";
  if (["declined", "failed", "failure", "rejected", "cancelled", "canceled", "refunded", "chargeback", "expired", "overdue"].includes(status)) return "declined";
  return "error";
};

const parseObjectConfig = (value: unknown, name: string): JsonObject => {
  if (!text(value)) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!isObject(parsed)) throw new Error(`${name}_must_be_object`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(name)) throw error;
    throw new Error(`${name}_invalid_json`);
  }
};

const interpolate = (value: unknown, root: JsonObject): unknown => {
  if (Array.isArray(value)) return value.map((item) => interpolate(item, root));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, root)]));
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exact) return getPath(root, exact[1].trim()) ?? null;

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const resolved = getPath(root, String(path).trim());
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
};

const validateMethod = (value: unknown, fallback: string): string => {
  const method = (text(value) || fallback).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("gateway_http_method_invalid");
  return method;
};

const publicUrl = async (raw: string): Promise<string> => {
  const checked = await assertPublicHttpsUrl(raw);
  if (!checked.ok) throw new Error(`target_not_allowed:${checked.reason}`);
  return checked.url;
};

const buildHeaders = (credential: JsonObject, root: JsonObject): Record<string, string> => {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = text(credential.api_key ?? credential.access_token ?? credential.secret_key ?? credential.token);
  const authHeader = text(credential.auth_header) || "Authorization";
  const authPrefix = credential.auth_prefix === "" ? "" : (text(credential.auth_prefix) || "Bearer");
  if (token) headers[authHeader] = authPrefix ? `${authPrefix} ${token}` : token;

  const customHeaders = parseObjectConfig(credential.custom_headers, "custom_headers");
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding", "x-althea-internal-secret", "x-althea-gateway-id"]);
  for (const [key, value] of Object.entries(customHeaders)) {
    const name = key.trim();
    if (!name || blocked.has(name.toLowerCase()) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("gateway_header_invalid");
    if (!["string", "number", "boolean"].includes(typeof value)) throw new Error("gateway_header_value_invalid");
    headers[name] = String(interpolate(value, root));
  }

  const idempotencyKey = text(root.idempotency_key);
  const idempotencyHeader = text(credential.idempotency_header) || "Idempotency-Key";
  if (idempotencyKey && !headers[idempotencyHeader]) headers[idempotencyHeader] = idempotencyKey;
  return headers;
};

const operationPath = (operation: Operation, credential: JsonObject): string => {
  if (operation === "health_check") return text(credential.health_path) || "/health";
  if (operation === "refund") return text(credential.refund_path) || "/payments/{id}/refund";
  if (["payment_status", "retrieve_payment", "retrieve", "status"].includes(operation)) return text(credential.status_path) || "/payments/{id}";
  return text(credential.create_path) || "/payments";
};

const operationMethod = (operation: Operation, credential: JsonObject): string => {
  if (operation === "health_check") return validateMethod(credential.health_method, "GET");
  if (operation === "refund") return validateMethod(credential.refund_method, "POST");
  if (["payment_status", "retrieve_payment", "retrieve", "status"].includes(operation)) return validateMethod(credential.status_method, "GET");
  return validateMethod(credential.create_method, "POST");
};

async function executeGenericHttp(operation: Operation, body: JsonObject, credential: JsonObject): Promise<Response> {
  const baseUrl = await publicUrl(text(credential.base_url));
  const externalId = text(body.external_transaction_id ?? body.original_external_id ?? body.provider_transaction_id);
  const path = operationPath(operation, credential).replaceAll("{id}", encodeURIComponent(externalId));
  const targetUrl = await publicUrl(new URL(path, baseUrl).toString());

  const root: JsonObject = {
    amount: Number(body.amount ?? 0),
    currency: text(body.currency || "BRL").toUpperCase(),
    transaction_id: text(body.transaction_id) || null,
    external_transaction_id: externalId || null,
    payment_token: text(body.payment_token) || null,
    payment_method: isObject(body.payment_method) ? body.payment_method : {},
    customer: isObject(body.customer) ? body.customer : {},
    metadata: isObject(body.metadata) ? body.metadata : {},
    idempotency_key: text(body.idempotency_key) || null,
    product_id: body.product_id ?? null,
    funnel_id: body.funnel_id ?? null,
  };

  const headers = buildHeaders(credential, root);
  const method = operationMethod(operation, credential);
  const requestTemplate = text(credential.request_template)
    ? parseObjectConfig(credential.request_template, "request_template")
    : null;
  const payload = requestTemplate
    ? interpolate(requestTemplate, root)
    : {
        amount: root.amount,
        currency: root.currency,
        transaction_id: externalId || undefined,
        payment_token: root.payment_token || undefined,
        payment_method: root.payment_method,
        customer: root.customer,
        metadata: root.metadata,
      };

  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15_000) };
  if (!["GET", "DELETE"].includes(method)) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(payload);
  }

  const providerResponse = await fetch(targetUrl, init);
  const providerPayload = await parseJson(providerResponse);
  if (!providerResponse.ok) {
    return response({
      ok: false,
      error: providerError(providerPayload, `gateway_http_${providerResponse.status}`),
      failure_code: `http_${providerResponse.status}`,
    }, providerResponse.status >= 400 && providerResponse.status < 600 ? providerResponse.status : 502);
  }

  if (operation === "health_check") {
    return response({
      ok: true,
      status: "approved",
      provider_status: firstString(providerPayload, ["status", "state", "data.status"], "healthy"),
      response: providerPayload,
    });
  }

  const responseMap = parseObjectConfig(credential.response_mapping, "response_mapping");
  const idPath = text(responseMap.id) || "id";
  const statusPath = text(responseMap.status) || "status";
  const amountPath = text(responseMap.amount) || "amount";
  const currencyPath = text(responseMap.currency) || "currency";
  const id = getPath(providerPayload, idPath) ?? firstString(providerPayload, ["id", "transaction_id", "transactionId", "payment_id", "paymentId", "data.id", "data.transaction_id"], externalId);
  const providerStatus = String(getPath(providerPayload, statusPath) ?? firstString(providerPayload, ["status", "payment_status", "paymentStatus", "state", "data.status"], ""));
  const amount = getPath(providerPayload, amountPath) ?? firstString(providerPayload, ["amount", "value", "data.amount"], String(root.amount));
  const currency = getPath(providerPayload, currencyPath) ?? firstString(providerPayload, ["currency", "data.currency"], root.currency);
  const statusMapping = parseObjectConfig(credential.status_mapping, "status_mapping");

  return response({
    ok: true,
    id: String(id ?? externalId),
    external_id: String(id ?? externalId),
    status: normalizeStatus(providerStatus, statusMapping),
    provider_status: providerStatus,
    amount: Number(amount),
    currency: String(currency || root.currency).toUpperCase(),
    response: providerPayload,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return response({ ok: false, error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
  const supplied = request.headers.get("x-althea-internal-secret") ?? "";
  if (!expected || expected.length !== supplied.length) return response({ ok: false, error: "forbidden" }, 403);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  if (difference !== 0) return response({ ok: false, error: "forbidden" }, 403);

  let body: JsonObject;
  try {
    const parsed = await request.json();
    if (!isObject(parsed)) return response({ ok: false, error: "invalid_json" }, 400);
    body = parsed;
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const operation = text(body.operation).toLowerCase() as Operation;
  const gatewayId = text(body.gateway_id ?? request.headers.get("x-gateway-id"));
  const environment = text(body.environment).toLowerCase();
  if (!gatewayId) return response({ ok: false, error: "gateway_id_required" }, 422);
  if (!operation) return response({ ok: false, error: "operation_required" }, 422);
  if (environment && !["sandbox", "production"].includes(environment)) return response({ ok: false, error: "invalid_environment" }, 422);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return response({ ok: false, error: "server_configuration_error" }, 500);

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const gatewayResult = await db
    .from("gateways")
    .select("id,user_id,provider,environment,status")
    .eq("id", gatewayId)
    .maybeSingle();
  if (gatewayResult.error || !gatewayResult.data) return response({ ok: false, error: "gateway_not_found" }, 404);

  const gateway = gatewayResult.data;
  const gatewayEnvironment = text(gateway.environment).toLowerCase() === "sandbox" ? "sandbox" : "production";
  if (environment && environment !== gatewayEnvironment) return response({ ok: false, error: "gateway_environment_mismatch" }, 409);
  if (!["connected", "degraded"].includes(text(gateway.status).toLowerCase())) return response({ ok: false, error: "gateway_not_operational" }, 422);

  const registryResult = await db
    .from("gateway_provider_registry")
    .select("provider_key,adapter_key,operational,is_active")
    .eq("provider_key", text(gateway.provider).toLowerCase())
    .eq("is_active", true)
    .maybeSingle();
  if (registryResult.error) return response({ ok: false, error: "provider_registry_lookup_failed" }, 500);
  if (!registryResult.data) return response({ ok: false, error: "provider_not_registered" }, 422);
  if (registryResult.data.operational !== true) return response({ ok: false, error: "provider_adapter_not_operational" }, 422);

  const credentialResult = await db.rpc("resolve_gateway_credential_for_gateway", { p_gateway_id: gatewayId });
  if (credentialResult.error || !isObject(credentialResult.data)) return response({ ok: false, error: "provider_credential_missing" }, 422);
  const credential = isObject(credentialResult.data.credentials) ? credentialResult.data.credentials : credentialResult.data;
  if (!isObject(credential) || !text(credential.base_url)) return response({ ok: false, error: "gateway_base_url_missing" }, 422);

  try {
    return await executeGenericHttp(operation, body, credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : "gateway_adapter_error";
    return response({
      ok: false,
      error: message.startsWith("target_not_allowed") ? "target_not_allowed" : message,
    }, 502);
  }
});
