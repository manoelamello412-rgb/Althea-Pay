-- ALTHEA PAY Gateway Core hardening v2
-- Canonical gateway identity, server-only credential binding, and RLS performance hardening.

alter table public.gateways
  add column if not exists provider text,
  add column if not exists display_name text,
  add column if not exists environment text not null default 'production',
  add column if not exists status text not null default 'inactive',
  add column if not exists capabilities jsonb not null default '{"authorize":true,"capture":false,"refund":true,"void":false,"webhooks":true}'::jsonb,
  add column if not exists credential_id uuid;

update public.gateways
set provider = lower(trim(coalesce(data->>'provider', data->>'gateway_name', data->>'name', data->>'type', id)))
where provider is null or btrim(provider) = '';

update public.gateways
set display_name = coalesce(nullif(btrim(display_name), ''), initcap(replace(provider, '_', ' ')))
where display_name is null or btrim(display_name) = '';

alter table public.gateways
  alter column provider set not null,
  alter column display_name set not null;

alter table public.gateways
  add constraint gateways_provider_format_check check (provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  add constraint gateways_environment_check check (environment in ('sandbox','production')),
  add constraint gateways_status_check check (status in ('inactive','connecting','connected','degraded','error','disabled'));

create index if not exists gateways_user_provider_idx on public.gateways(user_id, provider);
create index if not exists gateways_user_status_idx on public.gateways(user_id, status);

alter table public.gateways
  add constraint gateways_credential_id_fkey
  foreign key (credential_id) references public.user_gateway_credentials(id) on delete set null;

create unique index if not exists gateways_user_provider_name_uq
  on public.gateways(user_id, provider, display_name);

revoke all on table public.user_gateway_credentials from anon, authenticated;

create or replace function public.list_gateway_credentials()
returns table(
  id uuid,
  gateway_name text,
  is_active boolean,
  priority_order integer,
  metadata jsonb
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select c.id, c.gateway_name::text, c.is_active, c.priority_order, coalesce(c.metadata, '{}'::jsonb)
  from public.user_gateway_credentials c
  where c.user_id = (select auth.uid())
  order by c.priority_order asc, c.gateway_name asc;
$$;
revoke all on function public.list_gateway_credentials() from public, anon;
grant execute on function public.list_gateway_credentials() to authenticated;

create or replace function public.resolve_gateway_credential_for_gateway(p_gateway_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare
  v_credential_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select g.credential_id
    into v_credential_id
  from public.gateways g
  where g.id = p_gateway_id
    and g.credential_id is not null
  limit 1;

  if v_credential_id is null then
    raise exception 'gateway_credential_not_bound';
  end if;

  return public.resolve_gateway_credential(v_credential_id);
end;
$$;
revoke all on function public.resolve_gateway_credential_for_gateway(text) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential_for_gateway(text) to service_role;

drop policy if exists gateway_circuit_states_select on public.gateway_circuit_states;
create policy gateway_circuit_states_select
on public.gateway_circuit_states
for select to authenticated
using (user_id = (select auth.uid()));

create index if not exists gateway_webhook_events_provider_event_idx
  on public.gateway_webhook_events(provider, provider_event_id);

comment on column public.gateways.credential_id is
  'Server-side binding to user_gateway_credentials. Credential plaintext is never stored on gateways.';
comment on column public.gateways.provider is
  'Canonical provider key used by the Gateway Adapter Registry.';
comment on column public.gateways.environment is
  'Explicit runtime environment. Sandbox and production are never inferred from adapter behavior.';
