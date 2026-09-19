create table if not exists public.organization_member_capabilities (
  organization_id uuid not null,
  user_id uuid not null,
  capability text not null,
  allowed boolean not null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, capability),
  constraint organization_member_capabilities_member_fkey
    foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id)
    on delete cascade,
  constraint organization_member_capabilities_updated_by_fkey
    foreign key (updated_by)
    references auth.users(id)
    on delete set null,
  constraint organization_member_capabilities_capability_check
    check (capability = any (array[
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
      'can_manage_integrations'
    ]::text[]))
);

comment on table public.organization_member_capabilities is
  'Per-member capability overrides. Missing rows inherit conservative role defaults. Visibility windows are access rules, not data-retention rules.';

create index if not exists organization_member_capabilities_user_idx
  on public.organization_member_capabilities(user_id);

alter table public.organization_member_capabilities enable row level security;

drop policy if exists organization_member_capabilities_select on public.organization_member_capabilities;
create policy organization_member_capabilities_select
on public.organization_member_capabilities
for select
to authenticated
using (
  user_id = auth.uid()
  or private.has_org_role(organization_id, array['owner','admin'])
);

drop policy if exists organization_member_capabilities_insert on public.organization_member_capabilities;
create policy organization_member_capabilities_insert
on public.organization_member_capabilities
for insert
to authenticated
with check (
  private.has_org_role(organization_id, array['owner','admin'])
);

drop policy if exists organization_member_capabilities_update on public.organization_member_capabilities;
create policy organization_member_capabilities_update
on public.organization_member_capabilities
for update
to authenticated
using (
  private.has_org_role(organization_id, array['owner','admin'])
)
with check (
  private.has_org_role(organization_id, array['owner','admin'])
);

drop policy if exists organization_member_capabilities_delete on public.organization_member_capabilities;
create policy organization_member_capabilities_delete
on public.organization_member_capabilities
for delete
to authenticated
using (
  private.has_org_role(organization_id, array['owner','admin'])
);

create or replace function private.role_has_org_capability(member_role text, requested_capability text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case requested_capability
    when 'can_view_chats' then member_role in ('owner','admin','manager','operator','supervisor','viewer')
    when 'can_reply_chats' then member_role in ('owner','admin','manager','operator','supervisor')
    when 'can_view_values' then member_role in ('owner','admin','manager','operator','supervisor')
    when 'can_manage_gateways' then member_role in ('owner','admin','manager')
    when 'can_change_funnel_gateway' then member_role in ('owner','admin','manager')
    when 'can_view_customers' then member_role in ('owner','admin','manager','operator','supervisor','viewer')
    when 'can_manage_members' then member_role in ('owner','admin')
    when 'can_view_audit' then member_role in ('owner','admin')
    when 'can_manage_funnels' then member_role in ('owner','admin','manager')
    when 'can_manage_products' then member_role in ('owner','admin','manager')
    when 'can_manage_automations' then member_role in ('owner','admin','manager')
    when 'can_manage_integrations' then member_role in ('owner','admin','manager')
    else false
  end;
$function$;

revoke all on function private.role_has_org_capability(text,text) from public, anon;
grant execute on function private.role_has_org_capability(text,text) to authenticated;

create or replace function private.has_org_capability(target_org uuid, requested_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_role text;
  v_override boolean;
begin
  if auth.uid() is null or target_org is null or requested_capability is null then
    return false;
  end if;

  select om.role
    into v_role
  from public.organization_members om
  where om.organization_id = target_org
    and om.user_id = auth.uid()
  limit 1;

  if v_role is null then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  select c.allowed
    into v_override
  from public.organization_member_capabilities c
  where c.organization_id = target_org
    and c.user_id = auth.uid()
    and c.capability = requested_capability;

  if found then
    return v_override;
  end if;

  return private.role_has_org_capability(v_role, requested_capability);
end;
$function$;

revoke all on function private.has_org_capability(uuid,text) from public, anon;
grant execute on function private.has_org_capability(uuid,text) to authenticated;

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

  if v_role in ('owner','admin') then
    return 2160;
  end if;

  if v_role in ('manager','operator','supervisor','viewer') then
    return 48;
  end if;

  return 0;
end;
$function$;

revoke all on function private.org_operational_history_hours(uuid) from public, anon;
grant execute on function private.org_operational_history_hours(uuid) to authenticated;

create or replace function private.enforce_organization_member_capability_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid := auth.uid();
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_target uuid := coalesce(new.user_id, old.user_id);
  v_actor_role text;
  v_target_role text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  select role into v_actor_role
  from public.organization_members
  where organization_id=v_org and user_id=v_actor;

  select role into v_target_role
  from public.organization_members
  where organization_id=v_org and user_id=v_target;

  if v_actor_role not in ('owner','admin') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if v_target = v_actor then
    raise exception 'SELF_CAPABILITY_CHANGE_FORBIDDEN' using errcode='42501';
  end if;

  if v_target_role is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_target_role = 'owner' then
    raise exception 'OWNER_CAPABILITIES_IMMUTABLE' using errcode='42501';
  end if;

  if v_actor_role = 'admin' and v_target_role = 'admin' then
    raise exception 'ADMIN_CANNOT_MODIFY_ADMIN' using errcode='42501';
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new.updated_by := v_actor;
    new.updated_at := now();
    return new;
  end if;

  return old;
end;
$function$;

drop trigger if exists enforce_organization_member_capability_authority
  on public.organization_member_capabilities;

create trigger enforce_organization_member_capability_authority
before insert or update or delete
on public.organization_member_capabilities
for each row
execute function private.enforce_organization_member_capability_authority();

create or replace function public.organization_my_access_v1(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_caps jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  v_org := p_organization_id;

  if v_org is null then
    select p.default_organization_id
      into v_org
    from public.profiles p
    where p.id=v_uid;
  end if;

  select om.role
    into v_role
  from public.organization_members om
  where om.organization_id=v_org
    and om.user_id=v_uid;

  if v_role is null then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using errcode='42501';
  end if;

  select jsonb_object_agg(capability, private.has_org_capability(v_org, capability))
    into v_caps
  from (values
    ('can_view_chats'),
    ('can_reply_chats'),
    ('can_view_values'),
    ('can_manage_gateways'),
    ('can_change_funnel_gateway'),
    ('can_view_customers'),
    ('can_manage_members'),
    ('can_view_audit'),
    ('can_manage_funnels'),
    ('can_manage_products'),
    ('can_manage_automations'),
    ('can_manage_integrations')
  ) as x(capability);

  return jsonb_build_object(
    'organization_id', v_org,
    'user_id', v_uid,
    'role', v_role,
    'capabilities', coalesce(v_caps,'{}'::jsonb),
    'operational_history_hours', private.org_operational_history_hours(v_org),
    'retention_policy', 'separate_from_visibility'
  );
end;
$function$;

revoke all on function public.organization_my_access_v1(uuid) from public, anon;
grant execute on function public.organization_my_access_v1(uuid) to authenticated;
