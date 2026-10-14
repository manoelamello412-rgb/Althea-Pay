// Caller authority for service-role Edge Functions (see organization_member_authority_v1).
// user_id on legacy rows is the operation owner; authorize by organization + capability, write as owner.

export type OrganizationCapability =
  | "can_view_chats"
  | "can_reply_chats"
  | "can_view_values"
  | "can_manage_gateways"
  | "can_view_customers"
  | "can_manage_integrations";

export type OrganizationAuthority = {
  organization_id: string;
  role: string;
  owner_user_id: string | null;
  capabilities: Partial<Record<OrganizationCapability, boolean>>;
};

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function organizationAuthority(
  db: RpcClient,
  userId: string,
  capabilities: OrganizationCapability[],
  organizationId: string | null = null,
): Promise<OrganizationAuthority | null> {
  const { data, error } = await db.rpc("organization_member_authority_v1", {
    p_user_id: userId,
    p_organization_id: organizationId,
    p_capabilities: capabilities,
  });
  if (error || !data || typeof data !== "object") return null;
  const authority = data as OrganizationAuthority;
  return typeof authority.organization_id === "string" ? authority : null;
}

export const can = (authority: OrganizationAuthority | null, capability: OrganizationCapability) =>
  authority?.capabilities?.[capability] === true;
