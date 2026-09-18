import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-althea-internal-secret",
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

  const requestBody = await request.json().catch(() => ({})) as Json;
  const batchId = text(requestBody.batch_id) || null;
  const requestedLimit = Number(requestBody.limit ?? 20);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1), 50);

  const db = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const suppliedSecret =
    request.headers.get("x-althea-internal-secret") ??
    request.headers.get("x-internal-secret") ??
    "";
  let internalCaller = false;
  if (suppliedSecret) {
    const verified = await db.rpc("verify_althea_internal_secret", {
      p_secret: suppliedSecret,
    });
    internalCaller = !verified.error && verified.data === true;
  }

  if (!internalCaller) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!batchId) return json({ ok: false, error: "batch_id_required" }, 422);

    const token = authorization.slice(7).trim();
    const userResult = await db.auth.getUser(token);
    const userId = userResult.data.user?.id;
    if (userResult.error || !userId) return json({ ok: false, error: "unauthorized" }, 401);

    const batchResult = await db
      .from("funnel_command_batches")
      .select("id,organization_id")
      .eq("id", batchId)
      .maybeSingle();
    if (batchResult.error || !batchResult.data) return json({ ok: false, error: "batch_not_found" }, 404);

    const membership = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", batchResult.data.organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    const role = text(membership.data?.role);
    if (membership.error || !["owner", "admin", "manager", "operator", "supervisor"].includes(role)) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
  }

  const workerId = `funnel-command-worker:${crypto.randomUUID()}`;
  let verified = 0;
  let preflighted = 0;
  let retried = 0;
  let failed = 0;
  let claimedTotal = 0;

  async function invokeAdapter(
    connectionId: string,
    operation: "get_gateway" | "set_gateway",
    targetRemoteGatewayRef: string | null,
    idempotencyKey: string,
  ): Promise<{ ok: boolean; payload: Json; retryable: boolean }> {
    try {
      const response = await fetch(
        `${supabaseUrl.replace(/\/$/, "")}/functions/v1/funnel-provider-adapter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: adminKey,
          },
          body: JSON.stringify({
            connection_id: connectionId,
            operation,
            target_remote_gateway_ref: targetRemoteGatewayRef,
            idempotency_key: idempotencyKey,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(35_000),
        },
      );

      const parsed = await response.json().catch(() => ({}));
      const payload = isObject(parsed) ? parsed : {};
      return {
        ok: response.ok && payload.ok === true,
        payload,
        retryable:
          payload.retryable === true ||
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        payload: { error: error instanceof Error ? error.message : "adapter_network_error" },
        retryable: true,
      };
    }
  }

  async function markFailure(
    targetId: string,
    payload: Json,
    retryable: boolean,
    remoteBefore: Json | null = null,
  ) {
    const result = await db.rpc("fail_funnel_command_target", {
      p_target_id: targetId,
      p_error_code: (text(payload.failure_code) || text(payload.error) || "remote_command_failed").slice(0, 120),
      p_error_message: (text(payload.error) || text(payload.message) || "Falha ao executar comando remoto.").slice(0, 2_000),
      p_retryable: retryable,
      p_remote_before: remoteBefore,
    });
    if (result.error) {
      console.error("funnel_command.fail_persist_failed", { target_id: targetId, code: result.error.code });
      failed += 1;
      return;
    }
    if (retryable) retried += 1;
    else failed += 1;
  }

  async function processTarget(rawTarget: Json) {
    const targetId = text(rawTarget.id);
    const targetBatchId = text(rawTarget.batch_id);
    const connectionId = text(rawTarget.connection_id);
    const targetRemoteGatewayRef = text(rawTarget.target_remote_gateway_ref);
    const targetCorrelationId = text(rawTarget.correlation_id);

    if (!targetId || !targetBatchId || !connectionId || !targetRemoteGatewayRef) {
      if (targetId) {
        await markFailure(targetId, { error: "invalid_command_target", failure_code: "invalid_command_target" }, false);
      }
      return;
    }

    const batchResult = await db
      .from("funnel_command_batches")
      .select("id,status,dry_run,metadata")
      .eq("id", targetBatchId)
      .maybeSingle();

    if (batchResult.error || !batchResult.data) {
      await markFailure(targetId, { error: "command_batch_not_found", failure_code: "command_batch_not_found" }, false);
      return;
    }

    const metadata = isObject(batchResult.data.metadata) ? batchResult.data.metadata : {};
    const phase = text(metadata.phase) || "preflight";

    const before = await invokeAdapter(connectionId, "get_gateway", null, targetCorrelationId);
    if (!before.ok) {
      await markFailure(targetId, before.payload, before.retryable);
      return;
    }

    const observedBefore = text(before.payload.observed_remote_gateway_ref);
    const beforePayload = isObject(before.payload.response) ? before.payload.response as Json : before.payload;
    if (!observedBefore) {
      await markFailure(
        targetId,
        { error: "remote_gateway_reference_missing", failure_code: "remote_gateway_reference_missing" },
        false,
        beforePayload,
      );
      return;
    }

    if (phase === "preflight") {
      const completed = await db.rpc("complete_funnel_command_preflight", {
        p_target_id: targetId,
        p_observed_remote_gateway_ref: observedBefore,
        p_remote_before: beforePayload,
        p_result_payload: { phase: "preflight", checked_at: new Date().toISOString() },
      });
      if (completed.error) {
        await markFailure(
          targetId,
          { error: "preflight_finalize_failed", failure_code: "preflight_finalize_failed" },
          true,
          beforePayload,
        );
      } else {
        preflighted += 1;
      }
      return;
    }

    await db
      .from("funnel_connections")
      .update({
        control_status: "syncing",
        desired_gateway_id: text(rawTarget.target_gateway_id) || null,
        last_command_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)
      .eq("organization_id", text(rawTarget.organization_id));

    if (observedBefore === targetRemoteGatewayRef) {
      const finalized = await db.rpc("finalize_funnel_gateway_switch_target", {
        p_target_id: targetId,
        p_observed_before: observedBefore,
        p_observed_after: observedBefore,
        p_remote_before: beforePayload,
        p_remote_after: beforePayload,
        p_result_payload: { phase: "execute", already_effective: true, verified_at: new Date().toISOString() },
      });
      if (finalized.error) {
        await markFailure(targetId, { error: "local_finalize_failed", failure_code: "local_finalize_failed" }, true, beforePayload);
      } else {
        verified += 1;
      }
      return;
    }

    const changed = await invokeAdapter(connectionId, "set_gateway", targetRemoteGatewayRef, targetCorrelationId);
    if (!changed.ok) {
      await markFailure(targetId, changed.payload, changed.retryable, beforePayload);
      return;
    }

    const after = await invokeAdapter(connectionId, "get_gateway", null, targetCorrelationId);
    if (!after.ok) {
      await markFailure(targetId, after.payload, after.retryable, beforePayload);
      return;
    }

    const observedAfter = text(after.payload.observed_remote_gateway_ref);
    const afterPayload = isObject(after.payload.response) ? after.payload.response as Json : after.payload;
    if (observedAfter !== targetRemoteGatewayRef) {
      await markFailure(
        targetId,
        {
          error: "remote_gateway_verification_failed",
          failure_code: "remote_gateway_verification_failed",
          expected: targetRemoteGatewayRef,
          observed: observedAfter,
        },
        true,
        beforePayload,
      );
      return;
    }

    const finalized = await db.rpc("finalize_funnel_gateway_switch_target", {
      p_target_id: targetId,
      p_observed_before: observedBefore,
      p_observed_after: observedAfter,
      p_remote_before: beforePayload,
      p_remote_after: afterPayload,
      p_result_payload: { phase: "execute", already_effective: false, verified_at: new Date().toISOString() },
    });

    if (finalized.error) {
      await markFailure(targetId, { error: "local_finalize_failed", failure_code: "local_finalize_failed" }, true, beforePayload);
      return;
    }
    verified += 1;
  }

  // For an interactive batch, cycle twice so a successful preflight can move
  // immediately into the execution phase. Cron/internal callers stay bounded.
  const maxCycles = batchId ? 3 : 1;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const claimed = await db.rpc("claim_funnel_command_targets", {
      p_worker_id: workerId,
      p_limit: limit,
      p_batch_id: batchId,
    });
    if (claimed.error) {
      console.error("funnel_command.claim_failed", { code: claimed.error.code });
      return json({ ok: false, error: "command_claim_failed" }, 500);
    }

    const targets = Array.isArray(claimed.data) ? claimed.data.filter(isObject) : [];
    claimedTotal += targets.length;
    if (!targets.length) break;

    for (const target of targets) await processTarget(target);
  }

  let batch: Json | null = null;
  if (batchId) {
    const finalBatch = await db
      .from("funnel_command_batches")
      .select("id,correlation_id,status,dry_run,total_targets,succeeded_targets,failed_targets,pending_targets,metadata,completed_at")
      .eq("id", batchId)
      .maybeSingle();
    if (finalBatch.data) batch = finalBatch.data as Json;
  }

  return json({
    ok: true,
    worker_id: workerId,
    claimed: claimedTotal,
    preflighted,
    verified,
    retried,
    failed,
    batch,
  });
});
