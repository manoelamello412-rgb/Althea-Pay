-- Foundation: prevent admins from granting or changing privileged owner/admin roles.
-- Owners retain full role-management authority; admins may manage non-privileged roles only.
drop policy if exists org_members_insert_admin on public.organization_members;
drop policy if exists org_members_update_admin on public.organization_members;

create policy org_members_insert_admin on public.organization_members
for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner'])
  or (private.has_org_role(organization_id, array['admin']) and role in ('manager','operator','supervisor','viewer'))
);

create policy org_members_update_admin on public.organization_members
for update to authenticated
using (
  private.has_org_role(organization_id, array['owner'])
  or (private.has_org_role(organization_id, array['admin']) and role in ('manager','operator','supervisor','viewer'))
)
with check (
  private.has_org_role(organization_id, array['owner'])
  or (private.has_org_role(organization_id, array['admin']) and role in ('manager','operator','supervisor','viewer'))
);
