import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import "npm:pg@8"

import { pipeline } from "npm:@supabase/middleware@1"
import {
  withPostgresAdminClient,
} from "npm:@supabase/server@1/middleware/postgres-admin"

import {
  decideAutoTriage,
} from "../_shared/crm-auto-triage.ts"

type Row = Record<string, unknown>

const internalSecret =
  Deno.env.get("CRM_AUTO_TRIAGE_PREVIEW_SECRET") ?? ""

const targetOrganizationId =
  Deno.env.get(
    "CRM_AUTO_TRIAGE_TARGET_ORGANIZATION_ID",
  ) ?? ""

const targetFunnelIds = new Set(
  (
    Deno.env.get(
      "CRM_AUTO_TRIAGE_TARGET_FUNNEL_IDS",
    ) ?? ""
  )
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
)

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(text(value))
}

function json(
  value: unknown,
  status = 200,
): Response {
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

function blocked(
  conversationId: string,
  reason: string,
): Response {
  return json({
    ok: true,
    dry_run: true,
    wrote_to_database: false,
    queued_message: false,
    action: "blocked",
    reason,
    conversation_id: conversationId,
  })
}

Deno.serve(
  pipeline(
    [
      withPostgresAdminClient({
        pool: {
          max: 1,
          checkoutTimeoutMs: 5000,
        },
        errors: {
          detailed: false,
        },
      }),
    ],
    async (request, context) => {
      if (request.method === "OPTIONS") {
        return json({ ok: true })
      }

      if (request.method !== "POST") {
        return json(
          {
            ok: false,
            error: "method_not_allowed",
          },
          405,
        )
      }

      const suppliedSecret =
        request.headers.get(
          "x-althea-internal-secret",
        ) ?? ""

      if (
        !internalSecret ||
        suppliedSecret !== internalSecret
      ) {
        return json(
          {
            ok: false,
            error: "forbidden",
          },
          403,
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

      const conversationId =
        text(payload?.conversation_id)

      if (!isUuid(conversationId)) {
        return json(
          {
            ok: false,
            error: "conversation_id_required",
          },
          400,
        )
      }

      const db = context.postgresAdmin

      try {
        const conversationRows = (
          await db.query`
            select
              id,
              user_id,
              organization_id,
              funnel_id,
              status,
              primary_channel,
              channel_account_id,
              buyer_name,
              buyer_email,
              customer_whatsapp
            from public.crm_conversations
            where id = ${conversationId}::uuid
              and organization_id =
                ${targetOrganizationId}::uuid
            limit 1
          `
        ) as Row[]

        const conversation =
          conversationRows[0]

        if (!conversation) {
          return json(
            {
              ok: false,
              error: "conversation_not_found",
            },
            404,
          )
        }

        const messageRows = (
          await db.query`
            select
              id,
              body,
              channel,
              created_at
            from public.crm_messages
            where conversation_id =
              ${conversationId}::uuid
              and organization_id =
                ${targetOrganizationId}::uuid
              and direction = 'inbound'
            order by created_at desc
            limit 1
          `
        ) as Row[]

        const latestMessage =
          messageRows[0]

        if (!latestMessage) {
          return json(
            {
              ok: false,
              error: "inbound_message_not_found",
            },
            404,
          )
        }

        const channel =
          text(
            latestMessage.channel,
          ).toLowerCase() ||
          text(
            conversation.primary_channel,
          ).toLowerCase()

        const identityRows = (
          await db.query`
            select
              phone_e164,
              email,
              external_user_id,
              updated_at
            from public.crm_channel_identities
            where conversation_id =
              ${conversationId}::uuid
              and channel = ${channel}
            order by updated_at desc
            limit 1
          `
        ) as Row[]

        const identity =
          identityRows[0] ?? {}

        const address =
          channel === "email"
            ? text(identity.email) ||
              text(conversation.buyer_email)
            : text(identity.phone_e164) ||
              text(identity.external_user_id) ||
              text(
                conversation.customer_whatsapp,
              )

        if (
          ["whatsapp", "sms", "email"].includes(
            channel,
          ) &&
          !address
        ) {
          return blocked(
            conversationId,
            "recipient_address_missing",
          )
        }

        let recipientOptedOut = false

        if (
          ["whatsapp", "sms", "email"].includes(
            channel,
          )
        ) {
          try {
            const consentRows = (
              await db.query`
                select
                  public.crm_channel_recipient_opted_out(
                    ${targetOrganizationId}::uuid,
                    ${channel},
                    ${address}
                  ) as opted_out
              `
            ) as Row[]

            recipientOptedOut =
              consentRows[0]?.opted_out === true
          } catch {
            return blocked(
              conversationId,
              "consent_check_failed",
            )
          }

          if (recipientOptedOut) {
            return blocked(
              conversationId,
              "recipient_opted_out",
            )
          }
        }

        const agentRows = (
          await db.query`
            select exists (
              select 1
              from public.crm_agents
              where organization_id =
                ${targetOrganizationId}::uuid
                and status = 'available'
            ) as human_available
          `
        ) as Row[]

        const humanAvailable =
          agentRows[0]?.human_available === true

        const belongsToTargetFunnel =
          targetFunnelIds.has(
            text(conversation.funnel_id),
          )

        const decision = decideAutoTriage({
          humanAvailable,
          belongsToTargetFunnel,
          message: text(latestMessage.body),
        })

        let quickReplyFound = false

        if ("replyTitle" in decision) {
          const quickReplyRows = (
            await db.query`
              select id
              from public.crm_quick_replies
              where organization_id =
                ${targetOrganizationId}::uuid
                and title =
                  ${decision.replyTitle}
                and active is true
              limit 1
            `
          ) as Row[]

          quickReplyFound =
            quickReplyRows.length > 0
        }

        return json({
          ok: true,
          dry_run: true,
          wrote_to_database: false,
          queued_message: false,
          conversation_id: conversationId,
          organization_id:
            targetOrganizationId,
          channel,
          recipient_opted_out:
            recipientOptedOut,
          human_available:
            humanAvailable,
          belongs_to_target_funnel:
            belongsToTargetFunnel,
          latest_message:
            text(latestMessage.body),
          decision,
          quick_reply_found:
            quickReplyFound,
        })
      } catch (error) {
        console.error(
          "crm-auto-triage-preview query failed",
          error instanceof Error
            ? error.message
            : "unknown_error",
        )

        return json(
          {
            ok: false,
            error:
              "preview_database_query_failed",
          },
          500,
        )
      }
    },
  ),
)
