import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const worker = readFileSync(
  "supabase/functions/crm-auto-triage-preview/index.ts",
  "utf8",
)

describe("CRM automatic triage preview worker", () => {
  it("uses a direct administrative Postgres connection", () => {
    expect(worker).toContain(
      "withPostgresAdminClient",
    )
    expect(worker).toContain(
      "context.postgresAdmin",
    )
    expect(worker).toContain(
      "from public.crm_conversations",
    )
    expect(worker).not.toContain(
      'createClient(',
    )
    expect(worker).not.toContain(
      '.from("crm_conversations")',
    )
  })

  it("uses an isolated preview secret", () => {
    expect(worker).toContain(
      "CRM_AUTO_TRIAGE_PREVIEW_SECRET",
    )
    expect(worker).not.toContain(
      'Deno.env.get("ALTHEA_INTERNAL_SECRET")',
    )
    expect(worker).toContain(
      "x-althea-internal-secret",
    )
  })

  it("requires an explicit conversation", () => {
    expect(worker).toContain(
      "conversation_id_required",
    )
    expect(worker).toContain(
      "conversationId",
    )
  })

  it("restricts access to the configured organization and funnels", () => {
    expect(worker).toContain(
      "CRM_AUTO_TRIAGE_TARGET_ORGANIZATION_ID",
    )
    expect(worker).toContain(
      "CRM_AUTO_TRIAGE_TARGET_FUNNEL_IDS",
    )
    expect(worker).toContain(
      "targetOrganizationId",
    )
    expect(worker).toContain(
      "targetFunnelIds",
    )
    expect(worker).toContain(
      "and organization_id =",
    )
  })

  it("checks blocking before deciding a response", () => {
    const consentCheck = worker.indexOf(
      "crm_channel_recipient_opted_out",
    )
    const routerCall = worker.indexOf(
      "decideAutoTriage({",
    )

    expect(consentCheck).toBeGreaterThan(-1)
    expect(routerCall).toBeGreaterThan(-1)
    expect(consentCheck).toBeLessThan(routerCall)
  })

  it("checks human availability before deciding a response", () => {
    const availabilityCheck = worker.indexOf(
      "human_available",
    )
    const routerCall = worker.indexOf(
      "decideAutoTriage({",
    )

    expect(availabilityCheck).toBeGreaterThan(-1)
    expect(routerCall).toBeGreaterThan(-1)
    expect(availabilityCheck).toBeLessThan(
      routerCall,
    )
  })

  it("remains a read-only dry run", () => {
    expect(worker).toContain(
      "dry_run: true",
    )
    expect(worker).toContain(
      "wrote_to_database: false",
    )
    expect(worker).toContain(
      "queued_message: false",
    )

    expect(worker).not.toContain(
      ".insert(",
    )
    expect(worker).not.toContain(
      ".update(",
    )
    expect(worker).not.toContain(
      ".delete(",
    )
    expect(worker).not.toContain(
      ".upsert(",
    )
    expect(worker).not.toContain(
      "insert into",
    )
    expect(worker).not.toContain(
      "update public.",
    )
    expect(worker).not.toContain(
      "delete from",
    )
    expect(worker).not.toContain(
      "crm_message_outbox",
    )
    expect(worker).not.toContain(
      "crm_interventions",
    )
  })

  it("does not call any delivery provider", () => {
    expect(worker).not.toContain(
      "infobip",
    )
    expect(worker).not.toContain(
      "sendMessage",
    )
    expect(worker).not.toContain(
      "dispatch",
    )
  })
})
