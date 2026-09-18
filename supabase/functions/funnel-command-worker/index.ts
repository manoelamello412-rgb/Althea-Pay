import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const constantTimeEqual = (left: string, right: string): boolean => {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-internal-secret") ?? "";

  if (!supabaseUrl || !serviceRole || !internalSecret) {
    return json({ ok: false, error: "server_configuration_error" }, 500);
  }
  if (!constantTimeEqual(internalSecret, suppliedSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const requestBody = await request.json().catch(() => ({})) as Json;
  const requestedLimit = Number(requestBody.limit ?? 20);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1),
    50,
  );

  const db = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const workerId = `funnel-command-worker:${crypto.randomUUID()}`;

  const claimed = await db.rpc("claim_funnel_command_targets", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (claimed.error) {
    console.error("funnel_command.claim_failed", { code: claimed.error.code });
    return json({ ok: false, error: "command_claim_failed" }, 500);
  }

  const targets = Array.isArray(claimed.data) ? claimed.data : [];
  let verified = 0;
  let preflighted = 0;
  let retried = 0;
  let failed = 0;

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
            "x-althea-internal-secret": internalSecret,
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
        payload: {
          error: error instanceof Error ? error.message : "adapter_network_error",
        },
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
    const errorCode =
      text(payload.failure_code) ||
      text(payload.error) ||
      "remote_command_failed";
    const errorMessage =
      text(payload.error) ||
      text(payload.message) ||
      "Falha ao executar comando remoto.";

    const result = await db.rpc("fail_funnel_command_target", {
      p_target_id: targetId,
      p_error_code: errorCode.slice(0, 120),
      p_error_message: errorMessage.slice(0, 2_000),
      p_retryable: retryable,
      p_remote_before: remoteBefore,
    });
    if (result.error) {
      console.error("funnel_command.fail_persist_failed", {
        target_id: targetId,
        code: result.error.code,
      });
      return;
    }

    const state = isObject(result.data) ? text(result.data.status) : "";
    if (state === "queued" || state === "running") retried += 1;
    else failed += 1;
  }

  for (const rawTarget of targets) {
    if (!isObject(rawTarget)) continue;

    const targetId = text(rawTarget.id);
    const batchId = text(rawTarget.batch_id);
    const connectionId = text(rawTarget.connection_id);
    const targetRemoteGatewayRef = text(rawTarget.target_remote_gateway_ref);
    const targetCorrelationId = text(rawTarget.correlation_id);

    if (!targetId || !batchId || !connectionId || !targetRemoteGatewayRef) {
      if (targetId) {
        await markFailure(
          targetId,
          { error: "invalid_command_target", failure_code: "invalid_command_target" },
          false,
        );
      }
      continue;
    }

    const batchResult = await db
      .from("funnel_command_batches")
      .select("id,status,dry_run,metadata")
      .eq("id", batchId)
      .maybeSingle();

    if (batchResult.error || !batchResult.data) {
      await markFailure(
        targetId,
        { error: "command_batch_not_found", failure_code: "command_batch_not_found" },
        false,
      );
      continue;
    }

    const batchMetadata = isObject(batchResult.data.metadata)
      ? batchResult.data.metadata
      : {};
    const phase = text(batchMetadata.phase) || "preflight";

    const before = await invokeAdapter(
      connectionId,
      "get_gateway",
      null,
      targetCorrelationId,
    );

    if (!before.ok) {
      await markFailure(targetId, before.payload, before.retryable);
      continue;
    }

    const observedBefore = text(before.payload.observed_remote_gateway_ref);
    const beforePayload = isObject(before.payload.response)
      ? before.payload.response as Json
      : before.payload;

    if (!observedBefore) {
      await markFailure(
        targetId,
        {
          error: "remote_gateway_reference_missing",
          failure_code: "remote_gateway_reference_missing",
        },
        false,
        beforePayload,
      );
      continue;
    }

    if (phase === "preflight") {
      const completed = await db.rpc("complete_funnel_command_preflight", {
        p_target_id: targetId,
        p_observed_remote_gateway_ref: observedBefore,
        p_remote_before: beforePayload,
        p_result_payload: {
          phase: "preflight",
          checked_at: new Date().toISOString(),
        },
      });

      if (completed.error) {
        console.error("funnel_command.preflight_finalize_failed", {
          target_id: targetId,
          code: completed.error.code,
        });
        await markFailure(
          targetId,
          {
            error: "preflight_finalize_failed",
            failure_code: "preflight_finalize_failed",
          },
          true,
          beforePayload,
        );
      } else {
        preflighted += 1;
      }
      continue;
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
        p_result_payload: {
          phase: "execute",
          already_effective: true,
          verified_at: new Date().toISOString(),
        },
      });

      if (finalized.error) {
        await markFailure(
          targetId,
          {
            error: "local_finalize_failed",
            failure_code: "local_finalize_failed",
          },
          true,
          beforePayload,
        );
      } else {
        verified += 1;
      }
      continue;
    }

    const changed = await invokeAdapter(
      connectionId,
      "set_gateway",
      targetRemoteGatewayRef,
      targetCorrelationId,
    );

    if (!changed.ok) {
      // A timeout can happen after the provider has accepted the mutation.
      // The durable retry always performs GET first and will finalize without
      // issuing a second write when the desired state is already effective.
      await markFailure(targetId, changed.payload, changed.retryable, beforePayload);
      continue;
    }

    const after = await invokeAdapter(
      connectionId,
      "get_gateway",
      null,
      targetCorrelationId,
    );

    if (!after.ok) {
      await markFailure(targetId, after.payload, after.retryable, beforePayload);
      continue;
    }

    const observedAfter = text(after.payload.observed_remote_gateway_ref);
    const afterPayload = isObject(after.payload.response)
      ? after.payload.response as Json
      : after.payload;

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
      continue;
    }

    const finalized = await db.rpc("finalize_funnel_gateway_switch_target", {
      p_target_id: targetId,
      p_observed_before: observedBefore,
      p_observed_after: observedAfter,
      p_remote_before: beforePayload,
      p_remote_after: afterPayload,
      p_result_payload: {
        phase: "execute",
        already_effective: false,
        verified_at: new Date().toISOString(),
      },
    });

    if (finalized.error) {
      console.error("funnel_command.finalize_failed", {
        target_id: targetId,
        code: finalized.error.code,
      });
      await markFailure(
        targetId,
        {
          error: "local_finalize_failed",
          failure_code: "local_finalize_failed",
        },
        true,
        beforePayload,
      );
      continue;
    }

    verified += 1;
  }

  return json({
    ok: true,
    worker_id: workerId,
    claimed: targets.length,
    preflighted,
    verified,
    retried,
    failed,
  });
});
