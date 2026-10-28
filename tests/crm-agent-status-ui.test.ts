import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const statusComponent = readFileSync(
  'components/crm-agent-status.tsx',
  'utf8',
)

const dashboardLayout = readFileSync(
  'app/dashboard/layout.tsx',
  'utf8',
)

describe('CRM agent availability control', () => {
  it('identifies the authenticated organization member', () => {
    expect(statusComponent).toContain('organization_my_access_v1')
    expect(statusComponent).toContain('member_user_id')
    expect(statusComponent).toContain('organization_id')
    expect(statusComponent).toContain('can_reply_chats')
  })

  it('changes status only through the protected RPC', () => {
    expect(statusComponent).toContain('crm_my_agent_status_set')
    expect(statusComponent).toContain('available')
    expect(statusComponent).toContain('busy')
    expect(statusComponent).toContain('offline')
  })

  it('shows the control only inside the CRM', () => {
    expect(dashboardLayout).toContain(
      "import { CrmAgentStatus } from '@/components/crm-agent-status'",
    )

    expect(dashboardLayout).toContain(
      "pathname.startsWith('/dashboard/crm') && <CrmAgentStatus />",
    )
  })
})
