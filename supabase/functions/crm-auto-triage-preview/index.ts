import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { decideAutoTriage } from "../_shared/crm-auto-triage.ts"

type Row = Record<string, unknown>

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const internalSecret =
  Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? ""

const targetOrganizationId =
  Deno.env.get("CRM_AUTO_TRIAGE_TARGET_ORGANIZATION_ID") ?? ""

const targetFunnelIds = new Set(
  (Deno.env.get("CRM_AUTO_TRIAGE_TARGET_FUNNEL_IDS") ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
)

const db = createClient(
  supabaseUrl,
  serviceRoleKey,
  { auth: { persistSession: false } },
)

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value))
}

function json(value: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  )
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return json({ ok: true })
  }

  if (request.method !== "POST") {
    return json(
      { ok: false, error: "method_not_allowed" },
      405,
    )
  }

  const suppliedSecret =
    request.headers.get("x-althea-internal-secret") ?? ""

  if (!internalSecret || suppliedSecret !== internalSecret) {
    return json(
      { ok: false, error: "forbidden" },
      403,
    )
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { ok: false, error: "server_configuration_error" },
      500,
    )
  }

  if (
    !isUuid(targetOrganizationId) ||
    targetFunnelIds.size === 0
  ) {
    return json(
      {
        ok: false,
        error: "preview_scope_not_configured",
      },
      503,
    )
  }

  const payload = await request
    .json()
    .catch(() => null) as Row | null

  const conversationId = text(payload?.conversation_id)

  if (!isUuid(conversationId)) {
    return json(
      {
        ok: false,
        error: "conversation_id_required",
      },
      400,
    )
  }

  const conversationResult = await db
    .from("crm_conversations")
    .select(
      [
        "id",
        "user_id",
        "organization_id",
        "funnel_id",
        "status",
        "primary_channel",
        "channel_account_id",
        "buyer_name",
      ].join(","),
    )
    .eq("id", conversationId)
    .maybeSingle()

  if (
    conversationResult.error ||
    !conversationResult.data
  ) {
    return json(
      {
        ok: false,
        error: "conversation_not_found",
      },
      404,
    )
  }

  const conversation =
    conversationResult.data as Row

  if (
    text(conversation.organization_id) !==
      targetOrganizationId
  ) {
    return json(
      {
        ok: false,
        error: "conversation_outside_preview_scope",
      },
      403,
    )
  }

  const latestMessageResult = await db
    .from("crm_messages")
    .select("id,body,channel,created_at")
    .eq("conversation_id", conversationId)
    .eq("organization_id", targetOrganizationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (
    latestMessageResult.error ||
    !latestMessageResult.data
  ) {
    return json(
      {
        ok: false,
        error: "inbound_message_not_found",
      },
      404,
    )
  }

  const latestMessage =
    latestMessageResult.data as Row

  const channel =
    text(latestMessage.channel).toLowerCase()

  const identityResult = await db
    .from("crm_channel_identities")
    .select(
      "phone_e164,email,external_user_id,updated_at",
    )
    .eq("conversation_id", conversationId)
    .eq("channel", channel)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (identityResult.error) {
    return json(
      {
        ok: false,
        error: "contact_identity_lookup_failed",
      },
      500,
    )
  }

  const identity =
    (identityResult.data ?? {}) as Row

  const address = channel === "email"
    ? text(identity.email)
    : text(identity.phone_e164) ||
      text(identity.external_user_id)

  if (
    ["whatsapp", "sms", "email"].includes(channel) &&
    !address
  ) {
    return json({
      ok: true,
      dry_run: true,
      action: "blocked",
      reason: "recipient_address_missing",
      conversation_id: conversationId,
    })
  }

  if (
    ["whatsapp", "sms", "email"].includes(channel)
  ) {
    const consentResult = await db.rpc(
      "crm_channel_recipient_opted_out",
      {
        p_organization_id: targetOrganizationId,
        p_channel: channel,
        p_address: address,
      },
    )

    if (consentResult.error) {
      return json({
        ok: true,
        dry_run: true,
        action: "blocked",
        reason: "consent_check_failed",
        conversation_id: conversationId,
      })
    }

    if (consentResult.data === true) {
      return json({
        ok: true,
        dry_run: true,
        action: "blocked",
        reason: "recipient_opted_out",
        conversation_id: conversationId,
      })
    }
  }

  const agentsResult = await db
    .from("crm_agents")
    .select("id,name,status,member_user_id")
    .eq("organization_id", targetOrganizationId)
    .eq("status", "available")
    .limit(1)

  if (agentsResult.error) {
    return json(
      {
        ok: false,
        error: "agent_lookup_failed",
      },
      500,
    )
  }

  const humanAvailable =
    (agentsResult.data ?? []).length > 0

  const belongsToTargetFunnel =
    targetFunnelIds.has(text(conversation.funnel_id))

  const decision = decideAutoTriage({
    humanAvailable,
    belongsToTargetFunnel,
    message: text(latestMessage.body),
  })

  let quickReplyFound = false

  if ("replyTitle" in decision) {
    const replyResult = await db
      .from("crm_quick_replies")
      .select("id,title,active")
      .eq("organization_id", targetOrganizationId)
      .eq("title", decision.replyTitle)
      .eq("active", true)
      .maybeSingle()

    if (replyResult.error) {
      return json(
        {
          ok: false,
          error: "quick_reply_lookup_failed",
        },
        500,
      )
    }

    quickReplyFound = Boolean(replyResult.data)
  }

  return json({
    ok: true,
    dry_run: true,
    wrote_to_database: false,
    queued_message: false,
    conversation_id: conversationId,
    organization_id: targetOrganizationId,
    channel,
    recipient_opted_out: false,
    human_available: humanAvailable,
    belongs_to_target_funnel: belongsToTargetFunnel,
    latest_message: text(latestMessage.body),
    decision,
    quick_reply_found: quickReplyFound,
  })
})
