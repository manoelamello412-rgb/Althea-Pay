import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractGatewayWebhookFinancialFields,
  isGatewayWebhookRecord,
  normalizeGatewayWebhookStatus,
  type GatewayTransactionStatus,
  type JsonRecord,
} from "../_shared/gateway-webhook-normalization.ts";

type JsonRecordLocal = JsonRecord;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type,x-gateway-id,x-provider-event-id,stripe-signature,x-signature,x-request-id,asaas-access-token,x-webhook-signature",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const rec = isGatewayWebhookRecord;
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const safe = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value),
    ),
  );
}

const first = (obj: JsonRecordLocal, keys: string[]) => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
};

const legacySyncStatusAliases: Record<string, GatewayTransactionStatus> = {
  complete: "approved",
  denied: "failed",
  dispute: "chargeback",
};

const normalizeStatus = (value: unknown): GatewayTransactionStatus | null => {
  const canonical = normalizeGatewayWebhookStatus(value);
  if (canonical) return canonical;
  return legacySyncStatusAliases[String(value ?? "").trim().toLowerCase()] ?? null;
};

const rpcRows = (data: unknown): JsonRecordLocal[] => {
  if (Array.isArray(data)) return data.filter(rec);
  return rec(data) ? [data] : [];
};

const errorMessage = (error: unknown): string => {
  if (rec(error) && typeof error.message === "string") return error.message;
  return error instanceof Error ? error.message : String(error);
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRole || !supabaseUrl) {
    return json({ error: "server_configuration_error" }, 500);
  }

  const url = new URL(request.url);
  const gatewayId = (
    request.headers.get("x-gateway-id") ??
    url.searchParams.get("gateway_id") ??
    ""
  ).trim();
  if (!gatewayId) return json({ error: "gateway_id_required" }, 400);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  const gateway = await admin
    .from("gateways")
    .select("id,provider,environment,status,data")
    .eq("id", gatewayId)
    .maybeSingle();
  if (gateway.error || !gateway.data) {
    return json({ error: "gateway_not_found" }, 404);
  }

  const provider = String(gateway.data.provider).toLowerCase();
  const secretResult = await admin.rpc("resolve_gateway_webhook_secret", {
    p_gateway_id: gatewayId,
  });
  if (secretResult.error || !secretResult.data) {
    return json({ error: "webhook_secret_not_configured" }, 503);
  }

  const secret = String(secretResult.data);
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) {
    return json({ error: "payload_too_large" }, 413);
  }

  let payload: JsonRecordLocal;
  try {
    const parsed = JSON.parse(rawBody);
    if (!rec(parsed)) return json({ error: "invalid_payload" }, 400);
    payload = parsed;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  let valid = false;
  if (provider === "stripe") {
    const header = request.headers.get("stripe-signature") ?? "";
    const pairs = Object.fromEntries(
      header.split(",").map((x) => {
        const [k, ...v] = x.split("=");
        return [k, v.join("=")];
      }),
    );
    const timestamp = Number(pairs.t);
    const signature = String(pairs.v1 ?? "");
    if (
      !Number.isFinite(timestamp) ||
      !signature ||
      Math.abs(Date.now() - timestamp * 1000) > 300000
    ) {
      return json({ error: "invalid_or_stale_signature" }, 401);
    }
    valid = safe(
      await hmac(secret, `${timestamp}.${rawBody}`),
      signature.toLowerCase(),
    );
  } else if (provider === "asaas") {
    valid = safe(secret, request.headers.get("asaas-access-token") ?? "");
  } else if (provider === "mercado_pago") {
    const signature = request.headers.get("x-signature") ?? "";
    const requestId = request.headers.get("x-request-id") ?? "";
    const dataId =
      url.searchParams.get("data.id") ??
      (rec(payload.data) ? String(payload.data.id ?? "") : "");
    const parts = Object.fromEntries(
      signature.split(",").map((x) => {
        const [k, ...v] = x.split("=");
        return [k, v.join("=")];
      }),
    );
    const timestamp = String(parts.ts ?? "");
    const v1 = String(parts.v1 ?? "");
    if (
      !timestamp ||
      !v1 ||
      Math.abs(Date.now() - Number(timestamp) * 1000) > 300000
    ) {
      return json({ error: "invalid_or_stale_signature" }, 401);
    }
    valid = safe(
      await hmac(
        secret,
        `id:${dataId};request-id:${requestId};ts:${timestamp};`,
      ),
      v1.toLowerCase(),
    );
  } else {
    const registry = await admin
      .from("gateway_provider_registry")
      .select("webhook_config,is_active,operational")
      .eq("provider_key", provider)
      .maybeSingle();
    if (
      registry.error ||
      !registry.data ||
      registry.data.is_active !== true
    ) {
      return json({ error: "unsupported_webhook_provider" }, 422);
    }

    const cfg = rec(registry.data.webhook_config)
      ? registry.data.webhook_config
      : {};
    const gatewayData = rec(gateway.data.data) ? gateway.data.data : {};
    const gatewayWebhook = rec(gatewayData.webhook)
      ? gatewayData.webhook
      : {};

    const headerName = String(
      gatewayWebhook.signature_header ??
        cfg.signature_header ??
        "x-webhook-signature",
    ).toLowerCase();
    const supplied = request.headers.get(headerName) ?? "";
    const algorithm = String(
      gatewayWebhook.signature_algorithm ??
        cfg.signature_algorithm ??
        "hmac-sha256",
    ).toLowerCase();

    if (algorithm !== "hmac-sha256") {
      return json({ error: "unsupported_webhook_signature_algorithm" }, 422);
    }

    const signedValue = String(
      gatewayWebhook.signature_value ?? cfg.signature_value ?? rawBody,
    );
    const expected = await hmac(
      secret,
      signedValue === rawBody ? rawBody : signedValue,
    );
    valid = safe(
      expected,
      supplied.replace(/^sha256=/i, "").trim().toLowerCase(),
    );
  }

  if (!valid) return json({ error: "invalid_signature" }, 401);

  const eventId = (
    request.headers.get("x-provider-event-id") ??
    String(first(payload, ["id", "event_id", "eventId"]) ?? "")
  ).trim();
  if (!eventId || eventId.length > 300) {
    return json({ error: "provider_event_id_required" }, 400);
  }

  const ingested = await admin.rpc("ingest_gateway_webhook_v2", {
    p_gateway_id: gatewayId,
    p_provider: provider,
    p_provider_event_id: eventId,
    p_signature_timestamp: new Date().toISOString(),
    p_payload: { ...payload, _althea_gateway_id: gatewayId },
  });
  if (ingested.error) {
    return json(
      { error: "webhook_ingestion_failed", detail: ingested.error.message },
      500,
    );
  }

  const row = Array.isArray(ingested.data) ? ingested.data[0] : ingested.data;
  if (row?.duplicate) {
    return json({
      ok: true,
      duplicate: true,
      event_id: eventId,
      webhook_id: row?.webhook_id ?? null,
    });
  }

  const fields = extractGatewayWebhookFinancialFields(payload, {
    normalizeStatus,
  });

  if (!fields.status || !fields.externalTransactionId) {
    return json(
      {
        ok: true,
        accepted: true,
        event_id: eventId,
        webhook_id: row?.webhook_id ?? null,
        processed: false,
        reason: "awaiting_normalized_transaction_fields",
      },
      202,
    );
  }

  const webhookId = String(row?.webhook_id ?? "").trim();
  if (!webhookId) {
    return json(
      {
        error: "webhook_ingestion_failed",
        detail: "webhook_id_missing_after_ingest",
        event_id: eventId,
      },
      500,
    );
  }

  const claimed = await admin.rpc("server_claim_gateway_webhook_events_v1", {
    p_limit: 1,
    p_webhook_id: webhookId,
  });
  if (claimed.error) {
    return json(
      {
        error: "webhook_claim_failed",
        detail: claimed.error.message,
        event_id: eventId,
        webhook_id: webhookId,
      },
      500,
    );
  }

  const claim = rpcRows(claimed.data)[0];
  if (!claim) {
    return json(
      {
        ok: true,
        accepted: true,
        processed: false,
        event_id: eventId,
        webhook_id: webhookId,
        reason: "processing_claim_unavailable",
      },
      202,
    );
  }

  const claimAttempt = Number(claim.claim_attempt ?? 0);
  const processed = await admin.rpc(
    "server_process_claimed_gateway_webhook_v1",
    {
      p_webhook_id: webhookId,
      p_expected_attempt: claimAttempt,
      p_next_status: fields.status,
      p_external_transaction_id: fields.externalTransactionId,
      p_failure_code:
        fields.status === "failed" ? fields.failureCode : null,
      p_event_kind: fields.eventKind,
      p_amount: fields.amount,
      p_currency: fields.currency,
      p_external_event_id: eventId,
    },
  );

  if (processed.error) {
    if (errorMessage(processed.error).includes("gateway_webhook_fencing_lost")) {
      return json(
        {
          ok: true,
          accepted: true,
          processed: false,
          event_id: eventId,
          webhook_id: webhookId,
          reason: "processing_claim_unavailable",
        },
        202,
      );
    }

    const transitionRpc =
      claimAttempt >= 8
        ? "server_dead_letter_gateway_webhook_event_v1"
        : "server_fail_gateway_webhook_event_v1";
    const transition = await admin.rpc(transitionRpc, {
      p_webhook_id: webhookId,
      p_expected_attempt: claimAttempt,
      p_error: processed.error.message,
    });
    if (transition.error) {
      console.error(
        "webhook_processing_transition_failed",
        errorMessage(transition.error),
      );
    }

    return json(
      {
        error: "webhook_processing_failed",
        detail: processed.error.message,
        event_id: eventId,
        webhook_id: webhookId,
      },
      500,
    );
  }

  return json(
    {
      ok: true,
      accepted: true,
      processed: true,
      event_id: eventId,
      webhook_id: webhookId,
      status: fields.status,
      external_transaction_id: fields.externalTransactionId,
    },
    200,
  );
});
