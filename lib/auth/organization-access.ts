export const organizationCapabilities = [
  'can_view_chats',
  'can_reply_chats',
  'can_view_values',
  'can_manage_gateways',
  'can_change_funnel_gateway',
  'can_view_customers',
  'can_manage_members',
  'can_view_audit',
  'can_manage_funnels',
  'can_manage_products',
  'can_manage_automations',
  'can_manage_integrations',
] as const

export type OrganizationCapability = (typeof organizationCapabilities)[number]

export type OrganizationAccess = {
  organization_id: string
  user_id: string
  role: string
  capabilities: Record<OrganizationCapability, boolean>
  operational_history_hours: number
  retention_policy: string
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

export function parseOrganizationAccess(value: unknown): OrganizationAccess | null {
  const row = object(value)
  const organizationId = typeof row.organization_id === 'string' ? row.organization_id : ''
  const userId = typeof row.user_id === 'string' ? row.user_id : ''
  if (!organizationId || !userId) return null

  const rawCapabilities = object(row.capabilities)
  const capabilities = Object.fromEntries(
    organizationCapabilities.map(capability => [capability, rawCapabilities[capability] === true]),
  ) as Record<OrganizationCapability, boolean>

  return {
    organization_id: organizationId,
    user_id: userId,
    role: typeof row.role === 'string' ? row.role : 'viewer',
    capabilities,
    operational_history_hours: Number.isFinite(Number(row.operational_history_hours))
      ? Number(row.operational_history_hours)
      : 0,
    retention_policy: typeof row.retention_policy === 'string'
      ? row.retention_policy
      : 'separate_from_visibility',
  }
}

export function hasOrganizationCapability(
  access: OrganizationAccess | null,
  capability: OrganizationCapability,
) {
  return access?.capabilities[capability] === true
}
