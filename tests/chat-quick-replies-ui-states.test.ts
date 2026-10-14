import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const crm = readFileSync('app/dashboard/crm/page.tsx', 'utf8')
const replies = readFileSync('components/crm-quick-replies.tsx', 'utf8')
const layout = readFileSync('app/dashboard/layout.tsx', 'utf8')
const boundary = readFileSync('app/dashboard/error.tsx', 'utf8')

describe('chat quick replies and global UI states', () => {
  it('offers the organization quick replies in the composer, editable before sending', () => {
    expect(crm).toContain('<CrmQuickReplies organizationId={selected.organization_id}')
    expect(crm).toContain("disabled={sending||selected.status==='closed'||!canReplyChats}")
    expect(replies).toContain(".eq('organization_id', organizationId).eq('active', true)")
    expect(replies).toContain("reply.channel === 'all' || reply.channel === replyChannel(channel)")
    expect(replies).toContain('Não foi possível carregar as respostas rápidas.')
  })

  it('keeps the dashboard shell alive on crashes and tells the operator when the connection drops', () => {
    expect(layout).toContain('<ConnectionStatus />')
    expect(boundary).toContain('onClick={() => retry()}')
    expect(boundary).toContain('role="alert"')
  })
})
