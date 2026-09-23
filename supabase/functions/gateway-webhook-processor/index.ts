import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractGatewayWebhookFinancialFields,
  isGatewayWebhookRecord,
  normalizeGatewayWebhookStatus,
  type GatewayTransactionStatus,
  type JsonRecord,
} from "../_shared/gateway-webhook-normalization.ts";

type JsonObject = JsonRecord;

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(url, key, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const legacyAsyncStatusAliases: Record<string, GatewayTransactionStatus> = {
  charged_back: "chargeback",
};

const normalizeProcessorStatus = (
  value: unknown,
): GatewayTransactionStatus | null => {
  const canonical = normalizeGatewayWebhookStatus(value);
  if (canonical) return canonical;
  return legacyAsyncStatusAliases[String(value ?? "").trim().toLowerCase()] ?? null;
};

const rpcRows = (data: unknown): JsonObject[] => {
  if (Array.isArray(data)) return data.filter(isGatewayWebhookRecord);
  return isGatewayWebhookRecord(data) ? [data] : [];
};

const errorMessage = (error: unknown): string => {
  if (isGatewayWebhookRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
};

const isFencingLost = (error: unknown): boolean =>
  errorMessage(error).includes("gateway_webhook_fencing_lost");

async function callAutomation(payload: JsonObject): Promise<void> {
  if (!internalSecret) {
    console.error("automation_dispatch_skipped:internal_secret_missing");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${url}/functions/v1/automation-engine-v2`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) console.error(`automation_http_${response.status}`);
  } catch (error) {
    console.error("automation_dispatch_failed", errorMessage(error));
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchAutomationBestEffort(
  processingResult: unknown,
  webhookId: string,
  payload: JsonObject,
  externalId: string,
  status: GatewayTransactionStatus,
  eventKind: "payment" | "refund" | "chargeback",
): Promise<void> {
  try {
    if (!isGatewayWebhookRecord(processingResult) || !processingResult.transaction_id) {
      return;
    }

    const txResult = await db
      .from("gateway_transactions")
      .select("id,user_id,organization_id,funnel_id,metadata,external_id")
      .eq("id", String(processingResult.transaction_id))
      .maybeSingle();

    if (txResult.error) throw txResult.error;
    const tx = txResult.data;
    if (!tx?.organization_id) {
      console.error("automation_dispatch_skipped:transaction_organization_missing");
      return;
    }

    const txMetadata = isGatewayWebhookRecord(tx.metadata) ? tx.metadata : {};
    const canonicalEventProjected =
      String(txMetadata.source ?? "") === "checkout-engine-v2";
    if (canonicalEventProjected) return;

    await callAutomation({
      user_id: tx.user_id,
      organization_id: tx.organization_id,
      funnel_id: tx.funnel_id ?? null,
      event_type: `gateway.${eventKind}.${status}`,
      transaction_id: tx.id,
      external_id: `gateway_webhook_event:${webhookId}`,
      payload: {
        ...payload,
        provider_external_id: externalId,
        gateway_webhook_event_id: webhookId,
        gateway_status: status,
        gateway_event_kind: eventKind,
      },
    });
  } catch (error) {
    console.error("automation_post_processing_failed", errorMessage(error));
  }
}

async function deadLetterClaim(
  webhookId: string,
  claimAttempt: number,
  reason: string,
): Promise<"dead_lettered" | "fencing_lost"> {
  const transition = await db.rpc("server_dead_letter_gateway_webhook_event_v1", {
    p_webhook_id: webhookId,
    p_expected_attempt: claimAttempt,
    p_error: reason,
  });
  if (transition.error) {
    if (isFencingLost(transition.error)) return "fencing_lost";
    throw transition.error;
  }
  return transition.data === true ? "dead_lettered" : "fencing_lost";
}

async function failClaim(
  webhookId: string,
  claimAttempt: number,
  reason: string,
): Promise<"failed" | "fencing_lost"> {
  const transition = await db.rpc("server_fail_gateway_webhook_event_v1", {
    p_webhook_id: webhookId,
    p_expected_attempt: claimAttempt,
    p_error: reason,
  });
  if (transition.error) {
    if (isFencingLost(transition.error)) return "fencing_lost";
    throw transition.error;
  }
  return transition.data === true ? "failed" : "fencing_lost";
}

async function processClaim(
  event: JsonObject,
): Promise<"processed" | "dead_lettered" | "fencing_lost"> {
  const webhookId = String(event.webhook_id ?? "").trim();
  const claimAttempt = Number(event.claim_attempt ?? 0);
  if (!webhookId || !Number.isInteger(claimAttempt) || claimAttempt < 1) {
    throw new Error("gateway_webhook_claim_identity_missing");
  }

  const payload = isGatewayWebhookRecord(event.payload) ? event.payload : {};
  const fields = extractGatewayWebhookFinancialFields(payload, {
    normalizeStatus: normalizeProcessorStatus,
    fallbackStatus: event.event_type,
    fallbackExternalTransactionId: event.external_id,
    fallbackEventKind: event.event_type,
    extraExternalTransactionIdKeys: ["id"],
  });

  if (!fields.externalTransactionId) {
    return deadLetterClaim(
      webhookId,
      claimAttempt,
      "external_transaction_id_missing",
    );
  }
  if (!fields.status) {
    return deadLetterClaim(
      webhookId,
      claimAttempt,
      "unsupported_provider_status",
    );
  }

  const processing = await db.rpc("server_process_claimed_gateway_webhook_v1", {
    p_webhook_id: webhookId,
    p_expected_attempt: claimAttempt,
    p_next_status: fields.status,
    p_external_transaction_id: fields.externalTransactionId,
    p_failure_code: fields.failureCode,
    p_event_kind: fields.eventKind,
    p_amount:
      fields.amount !== null && fields.amount > 0 ? fields.amount : null,
    p_currency: fields.currency?.toUpperCase() ?? null,
    p_external_event_id: event.provider_event_id
      ? String(event.provider_event_id)
      : null,
  });

  if (processing.error) {
    if (isFencingLost(processing.error)) {
      console.warn("gateway_webhook_fencing_lost", webhookId, claimAttempt);
      return "fencing_lost";
    }
    throw processing.error;
  }

  await dispatchAutomationBestEffort(
    processing.data,
    webhookId,
    payload,
    fields.externalTransactionId,
    fields.status,
    fields.eventKind,
  );

  return "processed";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const suppliedSecret = request.headers.get("x-internal-secret");
  if (!suppliedSecret) return json({ error: "unauthorized" }, 401);

  const auth = await db.rpc("verify_althea_internal_secret", {
    p_secret: suppliedSecret,
  });
  if (auth.error || auth.data !== true) return json({ error: "unauthorized" }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const requested =
      isGatewayWebhookRecord(body) && body.webhook_id
        ? String(body.webhook_id)
        : "";

    const claim = await db.rpc("server_claim_gateway_webhook_events_v1", {
      p_limit: requested ? 1 : 50,
      p_webhook_id: requested || null,
    });
    if (claim.error) throw claim.error;

    const events = rpcRows(claim.data);
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const event of events) {
      const webhookId = String(event.webhook_id ?? "").trim();
      const claimAttempt = Number(event.claim_attempt ?? 0);

      try {
        const outcome = await processClaim(event);
        if (outcome === "processed") processed++;
        if (outcome === "dead_lettered") deadLettered++;
      } catch (error) {
        const message = errorMessage(error);
        if (isFencingLost(error)) {
          console.warn("gateway_webhook_fencing_lost", webhookId, claimAttempt);
          continue;
        }

        if (!webhookId || !Number.isInteger(claimAttempt) || claimAttempt < 1) {
          console.error("gateway_webhook_claim_error", message);
          failed++;
          continue;
        }

        if (claimAttempt >= 8) {
          const outcome = await deadLetterClaim(webhookId, claimAttempt, message);
          if (outcome === "dead_lettered") deadLettered++;
        } else {
          const outcome = await failClaim(webhookId, claimAttempt, message);
          if (outcome === "failed") failed++;
        }
      }
    }

    return json({
      ok: true,
      scanned: events.length,
      claimed: events.length,
      processed,
      failed,
      dead_lettered: deadLettered,
    });
  } catch (error) {
    return json({ ok: false, error: errorMessage(error) }, 500);
  }
});
