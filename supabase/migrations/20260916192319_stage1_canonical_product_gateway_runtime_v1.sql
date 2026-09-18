begin;

-- ALTHEA PAY — Stage 1: canonical commercial relationship contract.
-- One operational model:
--   Funnel -> Product (through funnel_offers)
--   Funnel -> Gateway (through this table)
-- The gateway itself remains provider-agnostic; this table only selects which
-- registered gateway connection is used by a funnel.

create table if not exists public.funnel_gateway_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id text not null references public.funnels(id) on delete cascade,
  gateway_id text not null references public.gateways(id) on delete restrict,
  role text not null default 'payment' check (role in ('payment','backup')),
  priority integer not null default 0 check (priority >= 0),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, gateway_id)
);

create unique index if not exists funnel_gateway_bindings_one_primary_idx
  on public.funnel_gateway_bindings (funnel_id)
  where is_primary = true and status = 'active';

create index if not exists funnel_gateway_bindings_org_idx
  on public.funnel_gateway_bindings (organization_id, funnel_id);

create index if not exists funnel_gateway_bindings_gateway_idx
  on public.funnel_gateway_bindings (gateway_id, status);

alter table public.funnel_gateway_bindings enable row level security;

drop policy if exists funnel_gateway_bindings_select on public.funnel_gateway_bindings;
drop policy if exists funnel_gateway_bindings_insert on public.funnel_gateway_bindings;
drop policy if exists funnel_gateway_bindings_update on public.funnel_gateway_bindings;
drop policy if exists funnel_gateway_bindings_delete on public.funnel_gateway_bindings;

create policy funnel_gateway_bindings_select
on public.funnel_gateway_bindings
for select to authenticated
using (private.is_org_member(organization_id));

create policy funnel_gateway_bindings_insert
on public.funnel_gateway_bindings
for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor'])
  and exists (
    select 1 from public.funnels f
    where f.id = funnel_id
      and f.organization_id = organization_id
  )
  and exists (
    select 1 from public.gateways g
    where g.id = gateway_id
      and g.organization_id = organization_id
  )
);

create policy funnel_gateway_bindings_update
on public.funnel_gateway_bindings
for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']))
with check (
  private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor'])
  and exists (select 1 from public.funnels f where f.id = funnel_id and f.organization_id = organization_id)
  and exists (select 1 from public.gateways g where g.id = gateway_id and g.organization_id = organization_id)
);

create policy funnel_gateway_bindings_delete
on public.funnel_gateway_bindings
for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin','manager']));

create or replace function public.bind_funnel_gateway(
  p_funnel_id text,
  p_gateway_id text,
  p_role text default 'payment',
  p_priority integer default 0,
  p_make_primary boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  u uuid := auth.uid();
  funnel_org uuid;
  gateway_org uuid;
  binding_id uuid;
  clean_role text := lower(trim(coalesce(p_role, 'payment')));
  clean_priority integer := greatest(coalesce(p_priority, 0), 0);
begin
  if u is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if clean_role not in ('payment','backup') then
    raise exception 'invalid_gateway_binding_role' using errcode = '22023';
  end if;

  select f.organization_id
    into funnel_org
  from public.funnels f
  where f.id = p_funnel_id
    and coalesce(f.deleted_at is null, true);

  if funnel_org is null then
    raise exception 'funnel_not_found' using errcode = 'P0002';
  end if;

  select g.organization_id
    into gateway_org
  from public.gateways g
  where g.id = p_gateway_id;

  if gateway_org is null then
    raise exception 'gateway_not_found' using errcode = 'P0002';
  end if;

  if funnel_org <> gateway_org then
    raise exception 'funnel_gateway_organization_mismatch' using errcode = '23514';
  end if;

  if not private.has_org_role(funnel_org, array['owner','admin','manager','operator','supervisor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(funnel_org::text || ':funnel-gateway:' || p_funnel_id, 0));

  if coalesce(p_make_primary, true) then
    update public.funnel_gateway_bindings
       set is_primary = false,
           updated_at = now()
     where funnel_id = p_funnel_id
       and is_primary = true;
  end if;

  insert into public.funnel_gateway_bindings(
    organization_id, funnel_id, gateway_id, role, priority, is_primary, status
  ) values (
    funnel_org, p_funnel_id, p_gateway_id, clean_role, clean_priority,
    coalesce(p_make_primary, true), 'active'
  )
  on conflict (funnel_id, gateway_id) do update
    set organization_id = excluded.organization_id,
        role = excluded.role,
        priority = excluded.priority,
        is_primary = excluded.is_primary,
        status = 'active',
        updated_at = now()
  returning id into binding_id;

  return jsonb_build_object(
    'binding_id', binding_id,
    'organization_id', funnel_org,
    'funnel_id', p_funnel_id,
    'gateway_id', p_gateway_id,
    'role', clean_role,
    'priority', clean_priority,
    'is_primary', coalesce(p_make_primary, true),
    'status', 'active'
  );
end;
$$;

revoke all on function public.bind_funnel_gateway(text,text,text,integer,boolean) from public, anon;
grant execute on function public.bind_funnel_gateway(text,text,text,integer,boolean) to authenticated;

-- Canonical read surface for the admin UI. The frontend should use this
-- relationship instead of independently guessing how funnel/product/gateway
-- records are connected.
create or replace view public.v_funnel_commercial_context as
select
  f.id as funnel_id,
  f.organization_id,
  f.nome as funnel_name,
  f.url as external_url,
  f.endpoint as event_endpoint,
  f.status as funnel_status,
  f.funnel_type,
  fo.id as offer_id,
  fo.name as offer_name,
  fo.offer_type,
  fo.price as offer_price,
  fo.currency as offer_currency,
  fo.status as offer_status,
  p.id as product_id,
  p.name as product_name,
  p.currency as product_currency,
  fgb.id as gateway_binding_id,
  fgb.gateway_id,
  fgb.role as gateway_role,
  fgb.priority as gateway_priority,
  fgb.is_primary as gateway_is_primary,
  fgb.status as gateway_binding_status,
  g.display_name as gateway_name,
  g.provider as gateway_provider,
  g.environment as gateway_environment,
  g.status as gateway_status
from public.funnels f
left join public.funnel_offers fo
  on fo.funnel_id = f.id
left join public.products p
  on p.id = fo.product_id
left join public.funnel_gateway_bindings fgb
  on fgb.funnel_id = f.id
left join public.gateways g
  on g.id = fgb.gateway_id
where coalesce(f.deleted_at is null, true);

revoke all on public.v_funnel_commercial_context from public, anon;
grant select on public.v_funnel_commercial_context to authenticated;

commit;
