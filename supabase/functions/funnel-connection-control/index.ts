import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";

type Json = Record<string, unknown>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const HEADERS = { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" };

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = adminKeyFromEnv();
  if (!supabaseUrl || !adminKey) {
    return json({ ok: false, error: "server_configuration_error" }, 500);
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const db = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice(7).trim();
  const userResult = await db.auth.getUser(token);
  const userId = userResult.data.user?.id;
  if (userResult.error || !userId) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  if (!isObject(body)) return json({ ok: false, error: "invalid_json" }, 400);

  const action = text(body.action);
  const funnelId = text(body.funnel_id);
  if (!funnelId) return json({ ok: false, error: "funnel_id_required" }, 422);

  const funnelResult = await db
    .from("funnels")
    .select("id,organization_id")
    .eq("id", funnelId)
    .is("deleted_at", null)
    .maybeSingle();

  if (funnelResult.error || !funnelResult.data) {
    return json({ ok: false, error: "funnel_not_found" }, 404);
  }

  const organizationId = funnelResult.data.organization_id;
  const membership = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = text(membership.data?.role);
  if (membership.error || !["owner", "admin", "manager", "operator", "supervisor"].includes(role)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const connectionResult = await db
    .from("funnel_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("funnel_id", funnelId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (connectionResult.error) return json({ ok: false, error: "connection_lookup_failed" }, 500);
  const current = connectionResult.data;

  if (action === "state") {
    const mappings = current?.id
      ? await db
          .from("funnel_connection_gateway_mappings")
          .select("id,gateway_id,remote_gateway_ref,status")
          .eq("connection_id", current.id)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

    if (mappings.error) return json({ ok: false, error: "mapping_lookup_failed" }, 500);

    const gateways = await db
      .from("gateways")
      .select("id,display_name,provider,environment,status")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (gateways.error) return json({ ok: false, error: "gateway_lookup_failed" }, 500);

    return json({
      ok: true,
      connection: current
        ? {
            id: current.id,
            funnel_id: current.funnel_id,
            adapter_key: current.adapter_key,
            remote_base_url: current.remote_base_url,
            remote_funnel_id: current.remote_funnel_id,
            capabilities: current.capabilities,
            write_enabled: current.write_enabled,
            desired_gateway_id: current.desired_gateway_id,
            observed_gateway_id: current.observed_gateway_id,
            last_verified_at: current.last_verified_at,
            last_command_at: current.last_command_at,
            control_status: current.control_status,
            health_status: current.health_status,
            last_error: current.last_error,
            has_credential: Boolean(current.credential_secret_id),
            remote_control: isObject(current.config) && isObject(current.config.remote_control)
              ? current.config.remote_control
              : {},
          }
        : null,
      mappings: mappings.data ?? [],
      gateways: gateways.data ?? [],
    });
  }

  if (action === "configure") {
    const remoteBaseUrl = text(body.remote_base_url);
    const remoteFunnelId = text(body.remote_funnel_id);
    const writeEnabled = body.write_enabled === true;
    if (!remoteBaseUrl || !remoteFunnelId) {
      return json({ ok: false, error: "remote_connection_fields_required" }, 422);
    }

    const checked = await assertPublicHttpsUrl(remoteBaseUrl);
    if (!checked.ok) return json({ ok: false, error: "remote_base_url_not_allowed" }, 422);

    const remoteControlInput = isObject(body.remote_control) ? body.remote_control : {};
    const remoteControl: Json = {
      gateway_get_path: text(remoteControlInput.gateway_get_path) || "/funnels/{{remote_funnel_id}}/gateway",
      gateway_get_method: text(remoteControlInput.gateway_get_method) || "GET",
      gateway_set_path: text(remoteControlInput.gateway_set_path) || text(remoteControlInput.gateway_get_path) || "/funnels/{{remote_funnel_id}}/gateway",
      gateway_set_method: text(remoteControlInput.gateway_set_method) || "PATCH",
      gateway_response_path: text(remoteControlInput.gateway_response_path) || "gateway_id",
      gateway_set_body: isObject(remoteControlInput.gateway_set_body)
        ? remoteControlInput.gateway_set_body
        : { gateway_id: "{{target_remote_gateway_ref}}" },
      idempotency_header: text(remoteControlInput.idempotency_header) || "Idempotency-Key",
      timeout_ms: Math.min(Math.max(Number(remoteControlInput.timeout_ms ?? 15_000), 1_000), 30_000),
    };

    const credentialInput = isObject(body.credential) ? body.credential : {};
    const hasCredential = Object.values(credentialInput).some((value) =>
      typeof value === "string" ? value.trim().length > 0 : value != null
    );

    let secretId = current?.credential_secret_id ?? null;
    if (hasCredential) {
      const serialized = JSON.stringify(credentialInput);
      const secretRpc = secretId
        ? await db.rpc("update_funnel_connection_secret", {
            p_secret_id: secretId,
            p_secret: serialized,
            p_name: `Althea funnel connector ${funnelId}`,
          })
        : await db.rpc("store_funnel_connection_secret", {
            p_secret: serialized,
            p_name: `Althea funnel connector ${funnelId}`,
          });
      if (secretRpc.error || !secretRpc.data) {
        return json({ ok: false, error: "credential_storage_failed" }, 500);
      }
      secretId = secretRpc.data;
    }

    if (!secretId) return json({ ok: false, error: "connector_credential_required" }, 422);

    const existingConfig = isObject(current?.config) ? current.config : {};
    const capabilities = writeEnabled
      ? ["events:read", "gateway:read", "gateway:write"]
      : ["events:read", "gateway:read"];

    const row = {
      user_id: current?.user_id ?? userId,
      funnel_id: funnelId,
      organization_id: organizationId,
      connection_type: "api",
      status: "active",
      config: { ...existingConfig, remote_control: remoteControl, connection_method: "api" },
      adapter_key: "generic_http_json",
      remote_base_url: checked.url.replace(/\/$/, ""),
      remote_funnel_id: remoteFunnelId,
      credential_secret_id: secretId,
      capabilities,
      write_enabled: writeEnabled,
      control_status: "degraded",
      last_error: null,
      updated_at: new Date().toISOString(),
      connected_at: current?.connected_at ?? new Date().toISOString(),
    };

    const saved = current?.id
      ? await db.from("funnel_connections").update(row).eq("id", current.id).eq("organization_id", organizationId).select("id,funnel_id,adapter_key,remote_base_url,remote_funnel_id,capabilities,write_enabled,control_status").single()
      : await db.from("funnel_connections").insert(row).select("id,funnel_id,adapter_key,remote_base_url,remote_funnel_id,capabilities,write_enabled,control_status").single();

    if (saved.error || !saved.data) return json({ ok: false, error: "connection_save_failed" }, 500);
    return json({ ok: true, connection: saved.data });
  }

  if (!current?.id) return json({ ok: false, error: "connection_not_configured" }, 422);

  if (action === "map_gateway") {
    const gatewayId = text(body.gateway_id);
    const remoteGatewayRef = text(body.remote_gateway_ref);
    if (!gatewayId || !remoteGatewayRef) {
      return json({ ok: false, error: "gateway_mapping_fields_required" }, 422);
    }

    const gateway = await db
      .from("gateways")
      .select("id,organization_id")
      .eq("id", gatewayId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (gateway.error || !gateway.data) return json({ ok: false, error: "gateway_not_found" }, 404);

    const mapping = await db
      .from("funnel_connection_gateway_mappings")
      .upsert({
        organization_id: organizationId,
        connection_id: current.id,
        funnel_id: funnelId,
        gateway_id: gatewayId,
        remote_gateway_ref: remoteGatewayRef,
        status: "active",
        updated_at: new Date().toISOString(),
      }, { onConflict: "connection_id,gateway_id" })
      .select("id,gateway_id,remote_gateway_ref,status")
      .single();

    if (mapping.error) return json({ ok: false, error: "gateway_mapping_save_failed" }, 500);
    return json({ ok: true, mapping: mapping.data });
  }

  if (action === "set_write_enabled") {
    const writeEnabled = body.write_enabled === true;
    const currentCapabilities = Array.isArray(current.capabilities)
      ? current.capabilities.map(String).filter((value) => value !== "gateway:write")
      : ["events:read", "gateway:read"];
    if (writeEnabled) currentCapabilities.push("gateway:write");

    const updated = await db
      .from("funnel_connections")
      .update({
        write_enabled: writeEnabled,
        capabilities: [...new Set(currentCapabilities)],
        control_status: writeEnabled ? "degraded" : "read_only",
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .eq("organization_id", organizationId)
      .select("id,write_enabled,capabilities,control_status")
      .single();

    if (updated.error) return json({ ok: false, error: "connection_update_failed" }, 500);
    return json({ ok: true, connection: updated.data });
  }

  if (action === "test") {
    try {
      const adapterResponse = await fetch(
        `${supabaseUrl.replace(/\/$/, "")}/functions/v1/funnel-provider-adapter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: adminKey,
          },
          body: JSON.stringify({ connection_id: current.id, operation: "get_gateway" }),
          signal: AbortSignal.timeout(35_000),
          redirect: "error",
        },
      );

      const payload = await adapterResponse.json().catch(() => ({}));
      if (!adapterResponse.ok || !isObject(payload) || payload.ok !== true) {
        const error = isObject(payload) ? text(payload.error) : "";
        await db
          .from("funnel_connections")
          .update({
            control_status: "error",
            health_status: "unhealthy",
            last_error: error || `adapter_http_${adapterResponse.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", current.id)
          .eq("organization_id", organizationId);
        return json({ ok: false, error: error || "connection_test_failed" }, 422);
      }

      const observedRef = text(payload.observed_remote_gateway_ref);
      const mapping = observedRef
        ? await db
            .from("funnel_connection_gateway_mappings")
            .select("gateway_id")
            .eq("connection_id", current.id)
            .eq("remote_gateway_ref", observedRef)
            .eq("status", "active")
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };

      const updated = await db
        .from("funnel_connections")
        .update({
          control_status: current.write_enabled ? "ready" : "read_only",
          health_status: "healthy",
          observed_gateway_id: mapping.data?.gateway_id ?? null,
          last_verified_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .eq("organization_id", organizationId);

      if (updated.error) return json({ ok: false, error: "connection_status_update_failed" }, 500);
      return json({
        ok: true,
        observed_remote_gateway_ref: observedRef || null,
        mapped_gateway_id: mapping.data?.gateway_id ?? null,
        latency_ms: payload.latency_ms ?? null,
        write_enabled: current.write_enabled === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "connection_test_failed";
      await db
        .from("funnel_connections")
        .update({
          control_status: "error",
          health_status: "unhealthy",
          last_error: message.slice(0, 2_000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .eq("organization_id", organizationId);
      return json({ ok: false, error: message }, 502);
    }
  }

  return json({ ok: false, error: "action_not_supported" }, 404);
});
