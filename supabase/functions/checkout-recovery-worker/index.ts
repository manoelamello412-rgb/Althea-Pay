import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type RecoveryJob = {
  event_id: string;
  user_id: string;
  organization_id: string;
  checkout_id: string;
  funnel_id: string | null;
  funnel_url: string | null;
  product_id: string | null;
  amount: number | string;
  currency: string;
  customer: Json | null;
  checkout_metadata: Json | null;
  recovery_count: number;
  event_attempt_count: number;
};
type Account = {
  id: string;
  channel: string;
  provider: string;
  display_name: string | null;
  status: string;
};
type Selection = {
  channel: "whatsapp" | "email" | "sms";
  account: Account;
  destination: string;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const objectOf = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function adminKeyFromEnv(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Json;
      const key = text(parsed.default);
      if (key) return key;
    } catch {
      // Fall through to the hosted service-role key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const adminKey = adminKeyFromEnv();
const db = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const truthy = (value: unknown): boolean => {
  if (value === true) return true;
  const normalized = text(value).toLowerCase();
  return ["1", "true", "yes", "sim", "accepted", "aceito", "granted", "opted_in"].includes(normalized);
};

function nested(source: Json, key: string): unknown {
  const direct = source[key];
  if (direct !== undefined) return direct;
  for (const parent of ["consent", "consents", "permissions", "preferences"]) {
    const group = objectOf(source[parent]);
    if (group[key] !== undefined) return group[key];
  }
  return undefined;
}

function channelConsent(customer: Json, metadata: Json, channel: string): boolean {
  const specific = channel === "whatsapp"
    ? ["whatsapp_opt_in", "whatsapp_consent", "consent_whatsapp"]
    : channel === "email"
      ? ["email_opt_in", "email_consent", "consent_email"]
      : ["sms_opt_in", "sms_consent", "consent_sms"];

  const generic = ["recovery_consent", "contact_consent", "marketing_consent"];
  for (const key of [...specific, ...generic]) {
    if (truthy(nested(customer, key)) || truthy(nested(metadata, key))) return true;
  }
  return false;
}

function phoneOf(customer: Json): string {
  return text(
    customer.phone_e164 ??
    customer.whatsapp ??
    customer.phone ??
    customer.telefone ??
    customer.customer_whatsapp,
  ).replace(/[^+\d]/g, "");
}

function emailOf(customer: Json): string {
  return text(customer.email ?? customer.customer_email).toLowerCase();
}

function nameOf(customer: Json): string {
  return text(customer.name ?? customer.full_name ?? customer.nome);
}

function recoveryUrl(job: RecoveryJob): string {
  const metadata = objectOf(job.checkout_metadata);
  return text(
    metadata.recovery_url ??
    metadata.checkout_url ??
    metadata.return_url ??
    metadata.resume_url ??
    job.funnel_url,
  );
}

function messageBody(job: RecoveryJob, customer: Json): string {
  const name = nameOf(customer);
  const url = recoveryUrl(job);
  const greeting = name ? `Olá, ${name}.` : "Olá.";
  const base = `${greeting} Vimos que sua compra não foi concluída. Se você quiser retomar de onde parou, podemos continuar por aqui.`;
  return url ? `${base} Link para retomar: ${url}` : base;
}

async function updateWorker(
  eventId: string,
  status: string,
  input: {
    channel?: string | null;
    conversationId?: string | null;
    outboxId?: string | null;
    error?: string | null;
    retrySeconds?: number | null;
  } = {},
) {
  const result = await db.rpc("update_checkout_recovery_worker_v1", {
    p_event_id: eventId,
    p_status: status,
    p_channel: input.channel ?? null,
    p_conversation_id: input.conversationId ?? null,
    p_outbox_id: input.outboxId ?? null,
    p_error: input.error ?? null,
    p_retry_seconds: input.retrySeconds ?? null,
  });
  if (result.error) throw result.error;
  return result.data;
}

async function accountsFor(userId: string): Promise<Account[]> {
  const result = await db
    .from("crm_channel_accounts")
    .select("id,channel,provider,display_name,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("channel", ["whatsapp", "email", "sms"]);
  if (result.error) throw result.error;
  return (result.data ?? []) as Account[];
}

function chooseChannel(job: RecoveryJob, accounts: Account[]): {
  selection: Selection | null;
  consentedChannels: string[];
  missingDestinationChannels: string[];
} {
  const customer = objectOf(job.customer);
  const metadata = objectOf(job.checkout_metadata);
  const phone = phoneOf(customer);
  const email = emailOf(customer);
  const destinations: Record<string, string> = { whatsapp: phone, sms: phone, email };
  const priority = ["whatsapp", "email", "sms"] as const;
  const consentedChannels = priority.filter((channel) => channelConsent(customer, metadata, channel));
  const missingDestinationChannels: string[] = [];

  for (const channel of consentedChannels) {
    const account = accounts.find((candidate) => candidate.channel === channel);
    if (!account) continue;
    const destination = destinations[channel];
    if (!destination) {
      missingDestinationChannels.push(channel);
      continue;
    }
    return { selection: { channel, account, destination }, consentedChannels, missingDestinationChannels };
  }

  return { selection: null, consentedChannels, missingDestinationChannels };
}

async function ensureConversation(job: RecoveryJob, selection: Selection): Promise<string> {
  const customer = objectOf(job.customer);
  const email = emailOf(customer);
  const phone = phoneOf(customer);
  const name = nameOf(customer);

  const byCheckout = await db
    .from("crm_conversations")
    .select("id")
    .eq("user_id", job.user_id)
    .contains("metadata", { checkout_id: job.checkout_id })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byCheckout.error) throw byCheckout.error;
  if (byCheckout.data?.id) {
    const updated = await db
      .from("crm_conversations")
      .update({
        primary_channel: selection.channel,
        channel_account_id: selection.account.id,
        buyer_name: name || null,
        buyer_email: email || null,
        customer_whatsapp: phone || null,
        status: "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", byCheckout.data.id)
      .eq("user_id", job.user_id);
    if (updated.error) throw updated.error;
    return String(byCheckout.data.id);
  }

  let existingId = "";
  if (email) {
    const byEmail = await db
      .from("crm_conversations")
      .select("id")
      .eq("user_id", job.user_id)
      .eq("buyer_email", email)
      .eq("funnel_id", job.funnel_id ?? "")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    existingId = text(byEmail.data?.id);
  }

  if (existingId) {
    const existing = await db
      .from("crm_conversations")
      .select("metadata")
      .eq("id", existingId)
      .eq("user_id", job.user_id)
      .single();
    if (existing.error) throw existing.error;
    const updated = await db
      .from("crm_conversations")
      .update({
        funnel_id: job.funnel_id,
        product_id: job.product_id,
        buyer_name: name || null,
        buyer_email: email || null,
        customer_whatsapp: phone || null,
        primary_channel: selection.channel,
        channel_account_id: selection.account.id,
        status: "open",
        metadata: {
          ...objectOf(existing.data?.metadata),
          checkout_id: job.checkout_id,
          recovery_event_id: job.event_id,
          recovery_source: "checkout_recovery",
          recovery_attempt: Number(job.recovery_count ?? 0) + 1,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId)
      .eq("user_id", job.user_id);
    if (updated.error) throw updated.error;
    return existingId;
  }

  const inserted = await db
    .from("crm_conversations")
    .insert({
      user_id: job.user_id,
      funnel_id: job.funnel_id,
      product_id: job.product_id,
      buyer_name: name || null,
      buyer_email: email || null,
      customer_whatsapp: phone || null,
      status: "open",
      primary_channel: selection.channel,
      channel_account_id: selection.account.id,
      metadata: {
        checkout_id: job.checkout_id,
        recovery_event_id: job.event_id,
        recovery_source: "checkout_recovery",
        recovery_attempt: Number(job.recovery_count ?? 0) + 1,
      },
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return String(inserted.data.id);
}

async function ensureIdentity(job: RecoveryJob, conversationId: string, selection: Selection) {
  const customer = objectOf(job.customer);
  const phone = phoneOf(customer);
  const email = emailOf(customer);
  const name = nameOf(customer);
  const externalUserId = selection.channel === "email" ? email : phone;
  if (!externalUserId) throw new Error("recovery_destination_missing");

  const result = await db
    .from("crm_channel_identities")
    .upsert({
      user_id: job.user_id,
      conversation_id: conversationId,
      channel: selection.channel,
      external_user_id: externalUserId,
      phone_e164: phone || null,
      email: email || null,
      display_name: name || null,
      metadata: {
        source: "checkout_recovery",
        checkout_id: job.checkout_id,
        consent_verified: true,
        consent_channel: selection.channel,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,channel,external_user_id" });
  if (result.error) throw result.error;
}

async function enqueueOutbox(job: RecoveryJob, conversationId: string, selection: Selection): Promise<string> {
  const attempt = Number(job.recovery_count ?? 0) + 1;
  const idempotencyKey = `checkout-recovery:${job.checkout_id}:${attempt}:${selection.channel}`;
  const body = messageBody(job, objectOf(job.customer));

  const inserted = await db
    .from("crm_channel_message_outbox")
    .insert({
      user_id: job.user_id,
      conversation_id: conversationId,
      channel_account_id: selection.account.id,
      channel: selection.channel,
      idempotency_key: idempotencyKey,
      body,
      status: "queued",
      metadata: {
        source: "checkout_recovery",
        recovery_event_id: job.event_id,
        recovery_checkout_id: job.checkout_id,
        recovery_attempt: attempt,
        funnel_id: job.funnel_id,
        product_id: job.product_id,
      },
    })
    .select("id")
    .maybeSingle();

  if (!inserted.error && inserted.data?.id) return String(inserted.data.id);

  if (inserted.error?.code !== "23505") throw inserted.error;

  const existing = await db
    .from("crm_channel_message_outbox")
    .select("id")
    .eq("user_id", job.user_id)
    .eq("idempotency_key", idempotencyKey)
    .single();
  if (existing.error) throw existing.error;
  return String(existing.data.id);
}

async function processJob(job: RecoveryJob): Promise<Json> {
  const accounts = await accountsFor(job.user_id);
  const choice = chooseChannel(job, accounts);

  if (choice.consentedChannels.length === 0) {
    await updateWorker(job.event_id, "blocked_consent", { error: "explicit_recovery_contact_consent_missing" });
    return { event_id: job.event_id, checkout_id: job.checkout_id, status: "blocked_consent" };
  }

  if (!choice.selection) {
    const channelsWithAccounts = choice.consentedChannels.filter((channel) =>
      accounts.some((account) => account.channel === channel)
    );

    if (channelsWithAccounts.length === 0) {
      await updateWorker(job.event_id, "blocked_no_channel", {
        error: "no_active_consented_channel_account",
        retrySeconds: 3600,
      });
      return { event_id: job.event_id, checkout_id: job.checkout_id, status: "blocked_no_channel" };
    }

    await updateWorker(job.event_id, "blocked_no_destination", {
      error: `destination_missing_for:${choice.missingDestinationChannels.join(",") || channelsWithAccounts.join(",")}`,
    });
    return { event_id: job.event_id, checkout_id: job.checkout_id, status: "blocked_no_destination" };
  }

  const conversationId = await ensureConversation(job, choice.selection);
  await ensureIdentity(job, conversationId, choice.selection);
  const outboxId = await enqueueOutbox(job, conversationId, choice.selection);
  await updateWorker(job.event_id, "outbox_queued", {
    channel: choice.selection.channel,
    conversationId,
    outboxId,
  });

  return {
    event_id: job.event_id,
    checkout_id: job.checkout_id,
    status: "outbox_queued",
    channel: choice.selection.channel,
    conversation_id: conversationId,
    outbox_id: outboxId,
  };
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

  const body = await request.json().catch(() => ({})) as Json;
  const requestedLimit = Number(body.limit ?? 25);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 25, 100));

  const claimed = await db.rpc("claim_checkout_recovery_events_v1", { p_limit: limit });
  if (claimed.error) return json({ ok: false, error: claimed.error.message }, 500);

  const jobs = Array.isArray(claimed.data) ? claimed.data as RecoveryJob[] : [];
  const results: Json[] = [];

  for (const job of jobs) {
    try {
      results.push(await processJob(job));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = Number(job.event_attempt_count ?? 1) >= 5;
      try {
        await updateWorker(job.event_id, terminal ? "dead_letter" : "retry", {
          error: message,
          retrySeconds: Math.min(3600, Math.max(60, 60 * (2 ** Math.min(Number(job.event_attempt_count ?? 1), 5)))),
        });
      } catch (persistError) {
        console.error("checkout_recovery.persist_failure", {
          event_id: job.event_id,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }
      results.push({
        event_id: job.event_id,
        checkout_id: job.checkout_id,
        status: terminal ? "dead_letter" : "retry",
        error: message,
      });
    }
  }

  return json({ ok: true, claimed: jobs.length, results });
});
