begin;

alter table public.crm_agents
  add column if not exists member_user_id uuid
  references auth.users(id)
  on delete set null;

create unique index if not exists crm_agents_org_member_unique_idx
  on public.crm_agents(organization_id, member_user_id)
  where member_user_id is not null;

create index if not exists crm_agents_org_status_idx
  on public.crm_agents(organization_id, status, last_assigned_at);

comment on column public.crm_agents.member_user_id is
  'Usuário do painel representado por este agente. A disponibilidade é definida manualmente.';

insert into public.crm_agents (
  user_id,
  organization_id,
  member_user_id,
  name,
  status
)
select
  owner_member.user_id,
  organization_member.organization_id,
  organization_member.user_id,
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'Atendente'
  ),
  'offline'
from public.organization_members as organization_member
join auth.users as auth_user
  on auth_user.id = organization_member.user_id
join lateral (
  select candidate.user_id
  from public.organization_members as candidate
  where candidate.organization_id = organization_member.organization_id
    and candidate.role = 'owner'
  order by candidate.created_at
  limit 1
) as owner_member on true
where organization_member.role in (
  'owner',
  'admin',
  'manager',
  'operator',
  'supervisor',
  'attendant'
)
on conflict (organization_id, member_user_id)
  where member_user_id is not null
do nothing;

revoke insert, update, delete
  on public.crm_agents
  from anon, authenticated;

grant select
  on public.crm_agents
  to authenticated;

create or replace function public.crm_my_agent_status_set(
  p_status text
)
returns public.crm_agents
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_organization_id uuid := private.current_organization_id();
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_agent public.crm_agents;
  v_owner_id uuid;
begin
  if auth.uid() is null or v_organization_id is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = '42501';
  end if;

  if not private.has_org_capability(
    v_organization_id,
    'can_reply_chats'
  ) then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  if v_status not in ('available', 'busy', 'offline') then
    raise exception 'AGENT_STATUS_INVALID'
      using errcode = '22023';
  end if;

  update public.crm_agents
  set status = v_status
  where organization_id = v_organization_id
    and member_user_id = auth.uid()
  returning * into v_agent;

  if not found then
    raise exception 'AGENT_NOT_REGISTERED'
      using errcode = 'P0002';
  end if;

  select member.user_id
  into v_owner_id
  from public.organization_members as member
  where member.organization_id = v_organization_id
    and member.role = 'owner'
  order by member.created_at
  limit 1;

  insert into public.audit_logs (
    user_id,
    actor_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    v_owner_id,
    auth.uid(),
    v_organization_id,
    'crm.agent.status_changed',
    'crm_agent',
    v_agent.id::text,
    jsonb_build_object(
      'status',
      v_agent.status,
      'member_user_id',
      v_agent.member_user_id
    )
  );

  return v_agent;
end;
$function$;

revoke all
  on function public.crm_my_agent_status_set(text)
  from public, anon;

grant execute
  on function public.crm_my_agent_status_set(text)
  to authenticated;

commit;
