create schema if not exists private;

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = auth.uid()); $$;

create or replace function private.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = auth.uid() and m.role = any(allowed_roles)); $$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid,text[]) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid,text[]) to authenticated;

drop policy if exists organizations_select_member on public.organizations;
drop policy if exists organizations_update_admin on public.organizations;
drop policy if exists organizations_delete_owner on public.organizations;
drop policy if exists org_members_select_member on public.organization_members;
drop policy if exists org_members_insert_admin on public.organization_members;
drop policy if exists org_members_update_admin on public.organization_members;
drop policy if exists org_members_delete_admin on public.organization_members;

create policy organizations_select_member on public.organizations for select to authenticated using (private.is_org_member(id));
create policy organizations_update_admin on public.organizations for update to authenticated using (private.has_org_role(id, array['owner','admin'])) with check (private.has_org_role(id, array['owner','admin']));
create policy organizations_delete_owner on public.organizations for delete to authenticated using (private.has_org_role(id, array['owner']));

create policy org_members_select_member on public.organization_members for select to authenticated using (private.is_org_member(organization_id));
create policy org_members_insert_admin on public.organization_members for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin']));
create policy org_members_update_admin on public.organization_members for update to authenticated using (private.has_org_role(organization_id, array['owner','admin'])) with check (private.has_org_role(organization_id, array['owner','admin']));
create policy org_members_delete_admin on public.organization_members for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin']));

drop function if exists public.is_org_member(uuid);
drop function if exists public.has_org_role(uuid,text[]);