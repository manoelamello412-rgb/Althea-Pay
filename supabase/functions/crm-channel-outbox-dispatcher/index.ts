import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Outbox = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  channel_account_id: string | null;
  channel: string;
  body: string;
  status: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  metadata: Json | null;
};
type Account = {
  id: string;
  user_id: string;
  channel: string;
  provider: string;
  external_account_id: string | null;
  status: string;
  credentials_ref: string | null;
  metadata: Json | null;
};
type Identity = {
  external_user_id: string | null;
  phone_e164: string | null;
  email: string | null;
  display_name: string | null;
  metadata: Json | null;
};
type DeliveryResult = { externalId: string; provider: string };
type ProviderHttpError = Error & { statusCode: number };

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function adminKeyFromEnv(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Json;
      const key = text(parsed.default);
      if (key) return key;
    } catch {
      // Fall through to the legacy hosted key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const adminKey = adminKeyFromEnv();
const db = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

function credentials(account: Account): Json {
  if (!account.credentials_ref) return {};
  const raw = Deno.env.get(account.credentials_ref);
  if (!raw) throw new Error("provider_credentials_not_configured");
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    return { access_token: raw };
  }
}
function meta(account: Account, key: string, fallback?: unknown) {
  return (account.metadata ?? {})[key] ?? fallback;
}
function backoff(attempt: number) {
  return Math.min(3600, Math.max(10, 2 ** Math.min(attempt, 10) * 5));
}
function providerHttpError(statusCode: number, message?: string): ProviderHttpError {
  const error = new Error(message || "provider_http_" + statusCode) as ProviderHttpError;
  error.statusCode = statusCode;
  return error;
}
function isRetryableProviderStatus(statusCode: number) {
  return statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}
function isValidExternalId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
async function responseJson(response: Response): Promise<Json> {
  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) throw providerHttpError(response.status);
  return isObject(payload) ? payload : {};
}

async function sendMeta(account: Account, identity: Identity, body: string): Promise<DeliveryResult> {
  const credential = credentials(account);
  const token = text(credential.access_token ?? credential.token);
  if (!token) throw new Error("meta_access_token_missing");
  const base = "https://graph.facebook.com/" + String(meta(account, "graph_version", "v23.0"));

  if (account.channel === "whatsapp") {
    const id = String(meta(account, "phone_number_id", account.external_account_id || ""));
    const to = identity.phone_e164 || identity.external_user_id;
    if (!id || !to) throw new Error("whatsapp_destination_missing");
    const response = await fetch(base + "/" + id + "/messages", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    });
    const payload = await responseJson(response);
    return { externalId: text((payload.messages as unknown[] | undefined)?.[0] && (payload.messages as Json[])[0]?.id ?? payload.message_id), provider: account.provider };
  }

  const page = String(meta(account, "page_id", account.external_account_id || ""));
  const to = identity.external_user_id;
  if (!page || !to) throw new Error(account.channel + "_destination_missing");
  const response = await fetch(base + "/" + page + "/messages", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
  });
  const payload = await responseJson(response);
  return { externalId: text(payload.message_id ?? payload.id), provider: account.provider };
}

async function sendResend(account: Account, identity: Identity, body: string): Promise<DeliveryResult> {
  const credential = credentials(account);
  const token = text(credential.api_key ?? credential.access_token ?? credential.token);
  const from = String(meta(account, "from_email", credential.from ?? ""));
  const to = identity.email;
  if (!token || !from || !to) throw new Error("email_configuration_missing");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: String(meta(account, "subject", "Mensagem da Althea Pay")), text: body }),
  });
  const payload = await responseJson(response);
  return { externalId: text(payload.id), provider: account.provider };
}

async function sendTwilio(account: Account, identity: Identity, body: string): Promise<DeliveryResult> {
  const credential = credentials(account);
  const sid = String(credential.account_sid ?? account.external_account_id ?? "");
  const auth = String(credential.auth_token ?? "");
  const from = String(meta(account, "from_number", credential.from ?? ""));
  const to = identity.phone_e164;
  if (!sid || !auth || !from || !to) throw new Error("twilio_configuration_missing");
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: { authorization: "Basic " + btoa(sid + ":" + auth), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const payload = await responseJson(response);
  return { externalId: text(payload.sid), provider: account.provider };
}

async function sendFunnelChat(row: Outbox): Promise<DeliveryResult> {
  if (!row.conversation_id) throw new Error("conversation_id_required");

  const conversationResult = await db
    .from("crm_conversations")
    .select("id,user_id,funnel_id,public_token,metadata")
    .eq("id", row.conversation_id)
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (conversationResult.error) throw conversationResult.error;
  if (!conversationResult.data) throw new Error("conversation_not_found");

  const conversation = conversationResult.data;
  const metadata = isObject(conversation.metadata) ? conversation.metadata : {};
  const deliveryMode = text(metadata.delivery_mode);
  const remoteConversationId = text(metadata.remote_conversation_id);

  if (deliveryMode !== "remote_api" && !remoteConversationId) {
    if (!conversation.public_token) throw new Error("funnel_chat_delivery_context_missing");
    const existing = await db
      .from("crm_messages")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("conversation_id", row.conversation_id)
      .contains("metadata", { outbox_id: row.id })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data?.id) throw new Error("local_funnel_chat_message_missing");
    return { externalId: "local:" + existing.data.id, provider: "funnel_chat_local" };
  }

  if (!conversation.funnel_id) throw new Error("funnel_id_required");
  if (!remoteConversationId) throw new Error("remote_conversation_id_required");

  const connectionResult = await db
    .from("funnel_connections")
    .select("id,status,capabilities")
    .eq("funnel_id", conversation.funnel_id)
    .eq("user_id", row.user_id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (connectionResult.error) throw connectionResult.error;
  if (!connectionResult.data) throw new Error("funnel_connection_not_configured");

  const capabilities = Array.isArray(connectionResult.data.capabilities)
    ? connectionResult.data.capabilities.map(String)
    : [];
  if (!capabilities.includes("chat:write")) throw new Error("funnel_chat_write_disabled");

  const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/funnel-provider-adapter", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: adminKey },
    body: JSON.stringify({
      connection_id: connectionResult.data.id,
      operation: "send_chat_message",
      remote_conversation_id: remoteConversationId,
      message_body: row.body,
      idempotency_key: row.idempotency_key,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(35_000),
  });

  const raw = await response.json().catch(() => ({}));
  const payload = isObject(raw) ? raw : {};
  if (!response.ok || payload.ok !== true) {
    throw providerHttpError(response.status, text(payload.error) || "funnel_chat_delivery_failed");
  }
  const externalMessageId = text(payload.external_message_id);
  if (!externalMessageId) throw new Error("missing_provider_external_id");
  return { externalId: externalMessageId, provider: "funnel_chat_remote" };
}

async function deliver(row: Outbox, account: Account | null, identity: Identity | null): Promise<DeliveryResult> {
  if (row.channel === "funnel_chat") return sendFunnelChat(row);
  if (!account || account.status !== "active") throw new Error("channel_account_not_active");
  if (!identity) throw new Error("channel_identity_not_found");

  const provider = account.provider.toLowerCase();
  if (["meta_whatsapp", "whatsapp_cloud", "meta_instagram", "instagram", "meta_messenger", "messenger"].includes(provider)) {
    return sendMeta(account, identity, row.body);
  }
  if (["resend", "email_resend"].includes(provider)) return sendResend(account, identity, row.body);
  if (["twilio", "sms_twilio"].includes(provider)) return sendTwilio(account, identity, row.body);
  throw new Error("unsupported_channel_provider:" + account.provider);
}

async function markLocalMessageDelivered(row: Outbox, delivery: DeliveryResult, deliveredAt: string) {
  if (!row.conversation_id) return;
  const existing = await db
    .from("crm_messages")
    .select("id,metadata")
    .eq("user_id", row.user_id)
    .eq("conversation_id", row.conversation_id)
    .contains("metadata", { outbox_id: row.id })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const currentMetadata = isObject(existing.data.metadata) ? existing.data.metadata : {};
    const updated = await db
      .from("crm_messages")
      .update({
        external_message_id: delivery.externalId,
        delivered_at: deliveredAt,
        provider: delivery.provider,
        metadata: {
          ...currentMetadata,
          outbox_id: row.id,
          external_message_id: delivery.externalId,
          delivery_status: "sent",
          provider: delivery.provider,
        },
      })
      .eq("id", existing.data.id)
      .eq("user_id", row.user_id);
    if (updated.error) throw updated.error;
    return;
  }

  const inserted = await db.from("crm_messages").insert({
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    direction: "outbound",
    channel: row.channel,
    body: row.body,
    provider: delivery.provider,
    external_message_id: delivery.externalId,
    delivered_at: deliveredAt,
    metadata: {
      ...(row.metadata ?? {}),
      outbox_id: row.id,
      external_message_id: delivery.externalId,
      delivery_status: "sent",
      provider: delivery.provider,
    },
  });
  if (inserted.error) throw inserted.error;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !adminKey) return json({ ok: false, error: "server_configuration_error" }, 500);

  const suppliedSecret =
    request.headers.get("x-internal-secret") ??
    request.headers.get("x-althea-internal-secret") ??
    "";
  const verified = await db.rpc("verify_althea_internal_secret", { p_secret: suppliedSecret });
  if (verified.error) return json({ ok: false, error: "internal_auth_unavailable" }, 500);
  if (verified.data !== true) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const body = await request.json().catch(() => ({})) as Json;
    const requestedLimit = Number(body.limit ?? 25);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 25, 100));

    const requeued = await db.rpc("crm_requeue_stale_channel_outbox", { p_age_minutes: 15 });
    if (requeued.error) throw requeued.error;

    const claimed = await db.rpc("crm_claim_channel_outbox_worker", { p_limit: limit });
    if (claimed.error) throw claimed.error;

    const rows = Array.isArray(claimed.data) ? claimed.data as Outbox[] : [];
    const results: Json[] = [];

    for (const row of rows) {
      try {
        let account: Account | null = null;
        let identity: Identity | null = null;

        if (row.channel_account_id) {
          const accountResult = await db
            .from("crm_channel_accounts")
            .select("id,user_id,channel,provider,external_account_id,status,credentials_ref,metadata")
            .eq("id", row.channel_account_id)
            .eq("user_id", row.user_id)
            .maybeSingle();
          if (accountResult.error) throw accountResult.error;
          account = accountResult.data as Account | null;
        }

        if (row.conversation_id && row.channel !== "funnel_chat") {
          const identityResult = await db
            .from("crm_channel_identities")
            .select("external_user_id,phone_e164,email,display_name,metadata")
            .eq("conversation_id", row.conversation_id)
            .eq("user_id", row.user_id)
            .eq("channel", row.channel)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (identityResult.error) throw identityResult.error;
          identity = identityResult.data as Identity | null;
        }

        const delivery = await deliver(row, account, identity);
        if (!isValidExternalId(delivery.externalId)) throw new Error("missing_provider_external_id");

        const now = new Date().toISOString();
        await markLocalMessageDelivered(row, delivery, now);

        const outboxUpdate = await db
          .from("crm_channel_message_outbox")
          .update({
            status: "sent",
            external_message_id: delivery.externalId,
            sent_at: now,
            updated_at: now,
            last_error: null,
          })
          .eq("id", row.id);
        if (outboxUpdate.error) throw outboxUpdate.error;

        results.push({ id: row.id, status: "sent", external_message_id: delivery.externalId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 0;
        const nonRetryable = [
          "provider_credentials_not_configured",
          "channel_account_not_active",
          "channel_identity_not_found",
          "missing_provider_external_id",
          "meta_access_token_missing",
          "whatsapp_destination_missing",
          "instagram_destination_missing",
          "messenger_destination_missing",
          "email_configuration_missing",
          "twilio_configuration_missing",
          "conversation_id_required",
          "conversation_not_found",
          "funnel_chat_delivery_context_missing",
          "local_funnel_chat_message_missing",
          "funnel_id_required",
          "remote_conversation_id_required",
          "funnel_connection_not_configured",
          "funnel_chat_write_disabled",
          "remote_chat_message_id_missing",
        ].includes(message) || message.startsWith("unsupported_channel_provider:");

        const retryable = statusCode > 0 ? isRetryableProviderStatus(statusCode) : !nonRetryable;
        const attempt = Math.max(1, Number(row.attempts ?? 1));
        const maxAttempts = Math.max(1, Number(row.max_attempts ?? 5));
        const terminal = !retryable || attempt >= maxAttempts;
        const safeError = statusCode > 0 ? message || "provider_http_" + statusCode : message;

        const failed = await db
          .from("crm_channel_message_outbox")
          .update({
            status: terminal ? "dead_letter" : "queued",
            next_attempt_at: terminal ? null : new Date(Date.now() + backoff(attempt) * 1000).toISOString(),
            failed_at: new Date().toISOString(),
            last_error: safeError.slice(0, 2000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (failed.error) console.error("crm_outbox.failure_persist_failed", { id: row.id, code: failed.error.code });

        results.push({
          id: row.id,
          status: terminal ? "dead_letter" : "retry_scheduled",
          error: safeError,
          error_classification: terminal ? "DLQ" : "RETRY",
        });
      }
    }

    return json({ ok: true, claimed: rows.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
