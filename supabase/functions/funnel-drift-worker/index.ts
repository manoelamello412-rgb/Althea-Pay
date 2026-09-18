import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const json = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

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

Deno.serve(async request => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = adminKeyFromEnv();
  const suppliedSecret =
    request.headers.get("x-althea-internal-secret") ??
    request.headers.get("x-internal-secret") ??
    "";
  if (!supabaseUrl || !adminKey) return json({ ok: false, error: "server_configuration_error" }, 500);

  const body = await request.json().catch(() => ({})) as Json;
  const requestedLimit = Number(body.limit ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const db = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await db.rpc("verify_althea_internal_secret", { p_secret: suppliedSecret });
  if (verified.error) return json({ ok: false, error: "internal_auth_unavailable" }, 500);
  if (verified.data !== true) return json({ ok: false, error: "unauthorized" }, 401);

  const connections = await db
    .from("funnel_connections")
    .select("id,organization_id,funnel_id,status,write_enabled,control_status,desired_gateway_id")
    .eq("status", "active")
    .eq("write_enabled", true)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (connections.error) return json({ ok: false, error: "connection_lookup_failed" }, 500);

  let checked = 0;
  let drifted = 0;
  let resolved = 0;
  let failed = 0;

  for (const connection of connections.data ?? []) {
    checked += 1;
    try {
      const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/funnel-provider-adapter", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: adminKey },
        body: JSON.stringify({ connection_id: connection.id, operation: "get_gateway" }),
        redirect: "error",
        signal: AbortSignal.timeout(35_000),
      });

      const raw = await response.json().catch(() => ({}));
      const payload = isObject(raw) ? raw : {};
      if (!response.ok || payload.ok !== true) {
        failed += 1;
        await db.from("funnel_connections").update({
          control_status: "degraded",
          health_status: "unhealthy",
          last_error: (text(payload.error) || "remote_state_check_failed").slice(0, 2000),
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", connection.id);
        continue;
      }

      const observedRemoteRef = text(payload.observed_remote_gateway_ref);
      const mapping = observedRemoteRef
        ? await db
            .from("funnel_connection_gateway_mappings")
            .select("gateway_id")
            .eq("connection_id", connection.id)
            .eq("remote_gateway_ref", observedRemoteRef)
            .eq("status", "active")
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };

      if (mapping.error) throw mapping.error;

      let expectedGatewayId = text(connection.desired_gateway_id);
      if (!expectedGatewayId) {
        const binding = await db
          .from("funnel_gateway_bindings")
          .select("gateway_id")
          .eq("organization_id", connection.organization_id)
          .eq("funnel_id", connection.funnel_id)
          .eq("is_primary", true)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (binding.error) throw binding.error;
        expectedGatewayId = text(binding.data?.gateway_id);
      }

      const observedGatewayId = text(mapping.data?.gateway_id);
      const isDrift = Boolean(expectedGatewayId) && observedGatewayId !== expectedGatewayId;

      if (isDrift) {
        drifted += 1;
        const open = await db
          .from("funnel_control_drift_events")
          .select("id")
          .eq("connection_id", connection.id)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();
        if (open.error) throw open.error;

        const driftRow = {
          organization_id: connection.organization_id,
          connection_id: connection.id,
          funnel_id: connection.funnel_id,
          expected_gateway_id: expectedGatewayId || null,
          observed_gateway_id: observedGatewayId || null,
          observed_remote_gateway_ref: observedRemoteRef || null,
          status: "open",
          details: {
            source: "funnel-drift-worker",
            mapping_found: Boolean(observedGatewayId),
            checked_at: new Date().toISOString(),
          },
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (open.data?.id) {
          const update = await db.from("funnel_control_drift_events").update(driftRow).eq("id", open.data.id);
          if (update.error) throw update.error;
        } else {
          const insert = await db.from("funnel_control_drift_events").insert(driftRow);
          if (insert.error) throw insert.error;
        }

        await db.from("funnel_connections").update({
          observed_gateway_id: observedGatewayId || null,
          control_status: "degraded",
          health_status: "healthy",
          last_error: observedGatewayId
            ? "Divergência detectada: a gateway ativa no funil externo difere do estado desejado."
            : "Divergência detectada: a gateway remota atual ainda não está mapeada na Althea.",
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", connection.id);
      } else {
        const open = await db
          .from("funnel_control_drift_events")
          .select("id")
          .eq("connection_id", connection.id)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();
        if (open.error) throw open.error;

        if (open.data?.id) {
          resolved += 1;
          const close = await db.from("funnel_control_drift_events").update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", open.data.id);
          if (close.error) throw close.error;
        }

        await db.from("funnel_connections").update({
          observed_gateway_id: observedGatewayId || null,
          control_status: "ready",
          health_status: "healthy",
          last_error: null,
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", connection.id);
      }
    } catch (error) {
      failed += 1;
      console.error("funnel_drift.check_failed", {
        connection_id: connection.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return json({ ok: true, checked, drifted, resolved, failed });
});
