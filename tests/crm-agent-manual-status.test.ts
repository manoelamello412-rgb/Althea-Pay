import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  "supabase/migrations/20261028164500_crm_agent_manual_status_v1.sql",
  "utf8",
)

describe("CRM manual agent availability", () => {
  it("links each CRM agent to a real organization member", () => {
    expect(migration).toContain(
      "add column if not exists member_user_id uuid",
    )

    expect(migration).toContain(
      "references auth.users(id)",
    )

    expect(migration).toContain(
      "crm_agents_org_member_unique_idx",
    )

    expect(migration).toContain(
      "on public.crm_agents(organization_id, member_user_id)",
    )
  })

  it("registers operational organization members as offline", () => {
    expect(migration).toContain(
      "from public.organization_members as organization_member",
    )

    expect(migration).toContain(
      "'owner'",
    )

    expect(migration).toContain(
      "'admin'",
    )

    expect(migration).toContain(
      "'attendant'",
    )

    expect(migration).toContain(
      "'offline'",
    )
  })

  it("allows only the logged user to change their own status", () => {
    expect(migration).toContain(
      "function public.crm_my_agent_status_set",
    )

    expect(migration).toContain(
      "member_user_id = auth.uid()",
    )

    expect(migration).toContain(
      "'can_reply_chats'",
    )

    expect(migration).toContain(
      "v_status not in ('available', 'busy', 'offline')",
    )
  })

  it("keeps direct table writes blocked", () => {
    expect(migration).toContain(
      "revoke insert, update, delete",
    )

    expect(migration).toContain(
      "from anon, authenticated",
    )

    expect(migration).toContain(
      "grant execute",
    )

    expect(migration).toContain(
      "to authenticated",
    )
  })

  it("records every status change in the audit log", () => {
    expect(migration).toContain(
      "insert into public.audit_logs",
    )

    expect(migration).toContain(
      "'crm.agent.status_changed'",
    )

    expect(migration).toContain(
      "'member_user_id'",
    )
  })
})
