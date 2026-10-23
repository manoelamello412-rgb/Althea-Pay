-- "Atendente" (attendant): a helper account for customer service only.
-- Capabilities: see the client list/contact data, see conversations, reply and work them (status, assignment).
-- Nothing financial (can_view_values), no settings, members, gateways, funnels, products or automations.
-- Every chat RPC is capability-gated, so the new role works there; RLS that lists roles explicitly
-- (owner/admin/manager/operator...) keeps it out of everything else by default.
-- History window: 90 days like admins, since following the conversation history is the job.

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in ('owner','admin','manager','operator','supervisor','viewer','attendant'));

create or replace function private.role_has_org_capability(member_role text, requested_capability text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case requested_capability
    when 'can_view_chats' then member_role in ('owner','admin','manager','operator','supervisor','viewer','attendant')
    when 'can_reply_chats' then member_role in ('owner','admin','manager','operator','supervisor','attendant')
    when 'can_view_values' then member_role in ('owner','admin','manager','operator','supervisor')
    when 'can_manage_gateways' then member_role in ('owner','admin','manager')
    when 'can_change_funnel_gateway' then member_role in ('owner','admin','manager')
    when 'can_view_customers' then member_role in ('owner','admin','manager','operator','supervisor','viewer','attendant')
    when 'can_manage_members' then member_role in ('owner','admin')
    when 'can_view_audit' then member_role in ('owner','admin')
    when 'can_manage_funnels' then member_role in ('owner','admin','manager')
    when 'can_manage_products' then member_role in ('owner','admin','manager')
    when 'can_manage_automations' then member_role in ('owner','admin','manager')
    when 'can_manage_integrations' then member_role in ('owner','admin','manager')
    else false
  end;
$function$;

create or replace function private.org_operational_history_hours(target_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_role text;
begin
  if auth.uid() is null or target_org is null then
    return 0;
  end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = target_org
    and om.user_id = auth.uid()
  limit 1;

  if v_role in ('owner','admin','attendant') then
    return 2160;
  end if;

  if v_role in ('manager','operator','supervisor','viewer') then
    return 48;
  end if;

  return 0;
end;
$function$;

drop policy if exists org_members_insert_admin on public.organization_members;
create policy org_members_insert_admin on public.organization_members for insert to authenticated with check (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
  and role = any(ARRAY['owner','admin','manager','operator','supervisor','viewer','attendant'])
);
drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin on public.organization_members for update to authenticated using (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
) with check (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
  and role = any(ARRAY['owner','admin','manager','operator','supervisor','viewer','attendant'])
);

-- Same as 20261022230000, accepting the new role from app_metadata.
create or replace function public.bootstrap_user_tenant() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org_id uuid; v_name text; v_slug text; v_role text;
begin
 v_name:=left(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,'workspace'),'@',1),'Workspace'),120);
 if new.raw_app_meta_data ? 'althea_member_org' then
  v_org_id:=(new.raw_app_meta_data->>'althea_member_org')::uuid;
  v_role:=new.raw_app_meta_data->>'althea_member_role';
  if v_role is null or v_role not in('admin','manager','operator','supervisor','viewer','attendant') then raise exception 'INVALID_MEMBER_ROLE' using errcode='22023'; end if;
  if not exists(select 1 from public.organizations where id=v_org_id) then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,v_role);
 else
  v_slug:='workspace-'||substr(md5(new.id::text),1,16);
  insert into public.organizations(name,slug) values(v_name,v_slug) on conflict(slug) do update set name=excluded.name returning id into v_org_id;
  insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,'owner') on conflict(organization_id,user_id) do update set role='owner';
 end if;
 insert into public.profiles(id,full_name,display_name,gender,default_organization_id) values(new.id,new.raw_user_meta_data->>'full_name',coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name'),case when new.raw_user_meta_data->>'gender' in('M','F','outro') then new.raw_user_meta_data->>'gender' else null end,v_org_id) on conflict(id) do update set default_organization_id=coalesce(public.profiles.default_organization_id,excluded.default_organization_id);
 return new; end; $$;

revoke all on function public.bootstrap_user_tenant() from public,authenticated,anon; grant execute on function public.bootstrap_user_tenant() to postgres;

create or replace function private.join_member_org_from_app_metadata() returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_org_id uuid := (new.raw_app_meta_data->>'althea_member_org')::uuid; v_role text := new.raw_app_meta_data->>'althea_member_role';
begin
 if v_role is null or v_role not in('admin','manager','operator','supervisor','viewer','attendant') then raise exception 'INVALID_MEMBER_ROLE' using errcode='22023'; end if;
 if not exists(select 1 from public.organizations where id=v_org_id) then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
 insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,v_role) on conflict(organization_id,user_id) do nothing;
 update public.profiles set default_organization_id=v_org_id,updated_at=now() where id=new.id;
 delete from public.organizations o where o.slug='workspace-'||substr(md5(new.id::text),1,16) and o.id<>v_org_id
   and not exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id<>new.id);
 return new; end; $$;

revoke all on function private.join_member_org_from_app_metadata() from public,authenticated,anon;
