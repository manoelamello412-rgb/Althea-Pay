
create table if not exists public.revenue_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  source_type text not null,
  source_ref_id text,
  name text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint revenue_sources_type_check check (
    source_type in (
      'funnel','direct_checkout','payment_link','subscription','affiliate',
      'marketplace','store','manual_sale','external_api','custom'
    )
  ),
  constraint revenue_sources_status_check check (
    status in ('draft','active','paused','degraded','error','archived')
  )
);

create unique index if not exists revenue_sources_org_type_ref_uidx
  on public.revenue_sources(organization_id,source_type,source_ref_id)
  where source_ref_id is not null;

create index if not exists revenue_sources_org_status_created_idx
  on public.revenue_sources(organization_id,status,created_at desc);

create index if not exists revenue_sources_user_created_idx
  on public.revenue_sources(user_id,created_at desc);

alter table public.revenue_sources enable row level security;

drop policy if exists revenue_sources_select_tenant on public.revenue_sources;
create policy revenue_sources_select_tenant
  on public.revenue_sources
  for select
  to authenticated
  using ((select private.is_org_member(revenue_sources.organization_id)));

drop policy if exists revenue_sources_insert_tenant on public.revenue_sources;
create policy revenue_sources_insert_tenant
  on public.revenue_sources
  for insert
  to authenticated
  with check (
    user_id=(select auth.uid())
    and (select private.has_org_role(
      revenue_sources.organization_id,
      array['owner','admin','manager','operator','supervisor']
    ))
  );

drop policy if exists revenue_sources_update_tenant on public.revenue_sources;
create policy revenue_sources_update_tenant
  on public.revenue_sources
  for update
  to authenticated
  using ((select private.has_org_role(
    revenue_sources.organization_id,
    array['owner','admin','manager','operator','supervisor']
  )))
  with check ((select private.has_org_role(
    revenue_sources.organization_id,
    array['owner','admin','manager','operator','supervisor']
  )));

drop policy if exists revenue_sources_delete_tenant on public.revenue_sources;
create policy revenue_sources_delete_tenant
  on public.revenue_sources
  for delete
  to authenticated
  using ((select private.has_org_role(
    revenue_sources.organization_id,
    array['owner','admin']
  )));

revoke all on table public.revenue_sources from anon;
grant select,insert,update,delete on table public.revenue_sources to authenticated;

create or replace function private.sync_funnel_revenue_source()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_status text;
begin
  v_status := case
    when new.deleted_at is not null then 'archived'
    when lower(coalesce(new.status,'')) in ('inactive','disabled','paused') then 'paused'
    when lower(coalesce(new.status,'')) in ('error','failed') then 'error'
    else 'active'
  end;

  insert into public.revenue_sources(
    organization_id,user_id,source_type,source_ref_id,name,status,metadata,created_at,updated_at
  )
  values(
    new.organization_id,
    new.user_id,
    'funnel',
    new.id,
    new.nome,
    v_status,
    jsonb_build_object('managed_by','funnel','funnel_type',new.funnel_type),
    coalesce(new.created_at,now()),
    now()
  )
  on conflict (organization_id,source_type,source_ref_id)
    where source_ref_id is not null
  do update set
    user_id=excluded.user_id,
    name=excluded.name,
    status=excluded.status,
    metadata=public.revenue_sources.metadata
      || jsonb_build_object('managed_by','funnel','funnel_type',new.funnel_type),
    updated_at=now();

  return new;
end;
$function$;

revoke all on function private.sync_funnel_revenue_source() from public,anon,authenticated;

create or replace function private.touch_revenue_source_updated_at()
returns trigger
language plpgsql
set search_path=pg_catalog
as $function$
begin
  new.updated_at=now();
  return new;
end;
$function$;

revoke all on function private.touch_revenue_source_updated_at() from public,anon,authenticated;

drop trigger if exists trg_sync_funnel_revenue_source on public.funnels;
create trigger trg_sync_funnel_revenue_source
after insert or update of nome,status,deleted_at,funnel_type,organization_id,user_id
on public.funnels
for each row execute function private.sync_funnel_revenue_source();

drop trigger if exists trg_touch_revenue_source_updated_at on public.revenue_sources;
create trigger trg_touch_revenue_source_updated_at
before update on public.revenue_sources
for each row execute function private.touch_revenue_source_updated_at();

insert into public.revenue_sources(
  organization_id,user_id,source_type,source_ref_id,name,status,metadata,created_at,updated_at
)
select
  f.organization_id,
  f.user_id,
  'funnel',
  f.id,
  f.nome,
  case
    when f.deleted_at is not null then 'archived'
    when lower(coalesce(f.status,'')) in ('inactive','disabled','paused') then 'paused'
    when lower(coalesce(f.status,'')) in ('error','failed') then 'error'
    else 'active'
  end,
  jsonb_build_object('managed_by','funnel','funnel_type',f.funnel_type),
  coalesce(f.created_at,now()),
  now()
from public.funnels f
on conflict (organization_id,source_type,source_ref_id)
  where source_ref_id is not null
do update set
  user_id=excluded.user_id,
  name=excluded.name,
  status=excluded.status,
  metadata=public.revenue_sources.metadata || excluded.metadata,
  updated_at=now();

create or replace function public.integration_hub_overview_v1(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),200));
begin
  if v_uid is null then
    raise exception using errcode='42501',message='unauthorized';
  end if;

  select default_organization_id into v_org
  from public.profiles
  where id=v_uid;

  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  return (
    with source_base as (
      select
        rs.id,
        rs.source_type,
        rs.source_ref_id,
        rs.name,
        rs.status,
        rs.created_at,
        rs.updated_at,
        f.funnel_type,
        f.url,
        c.id as connection_id,
        c.connection_type,
        c.status as connection_status,
        c.health_status,
        c.last_error,
        c.last_event_at,
        coalesce(c.event_count,0)::bigint as event_count,
        coalesce(c.error_count,0)::bigint as error_count,
        coalesce(c.write_enabled,false) as write_enabled,
        coalesce(c.control_status,'read_only') as control_status,
        coalesce(c.capabilities,'[]'::jsonb) as capabilities,
        coalesce(tok.has_ingestion_token,false) as has_ingestion_token,
        coalesce(wh.webhook_count,0)::bigint as webhook_count,
        coalesce(ofr.offer_count,0)::bigint as offer_count,
        coalesce(gb.gateway_count,0)::bigint as gateway_count,
        case
          when rs.status='archived' then 'archived'
          when c.id is null then 'needs_connection'
          when not coalesce(tok.has_ingestion_token,false) and coalesce(wh.webhook_count,0)=0 then 'needs_credential'
          when c.last_event_at is null and coalesce(c.event_count,0)=0 then 'awaiting_first_event'
          when lower(coalesce(c.health_status,'')) in ('unhealthy','error')
            or nullif(btrim(coalesce(c.last_error,'')),'') is not null then 'needs_attention'
          else 'operational'
        end as onboarding_status,
        (
          25
          + case when c.id is not null then 25 else 0 end
          + case when coalesce(tok.has_ingestion_token,false) or coalesce(wh.webhook_count,0)>0 then 25 else 0 end
          + case when c.last_event_at is not null or coalesce(c.event_count,0)>0 then 25 else 0 end
        )::integer as onboarding_progress
      from public.revenue_sources rs
      left join public.funnels f
        on rs.source_type='funnel'
       and f.id=rs.source_ref_id
       and f.organization_id=rs.organization_id
      left join lateral (
        select fc.*
        from public.funnel_connections fc
        where fc.organization_id=rs.organization_id
          and fc.funnel_id=rs.source_ref_id
        order by fc.created_at asc
        limit 1
      ) c on rs.source_type='funnel'
      left join lateral (
        select true as has_ingestion_token
        from public.funnel_ingestion_tokens t
        where t.organization_id=rs.organization_id
          and t.funnel_id=rs.source_ref_id
          and t.enabled=true
          and t.revoked_at is null
          and (t.expires_at is null or t.expires_at>now())
        limit 1
      ) tok on rs.source_type='funnel'
      left join lateral (
        select count(*)::bigint as webhook_count
        from public.webhook_integrations w
        where w.organization_id=rs.organization_id
          and w.funnel_id=rs.source_ref_id
          and w.status='active'
      ) wh on rs.source_type='funnel'
      left join lateral (
        select count(*)::bigint as offer_count
        from public.funnel_offers o
        where o.organization_id=rs.organization_id
          and o.funnel_id=rs.source_ref_id
          and o.status in ('active','draft')
      ) ofr on rs.source_type='funnel'
      left join lateral (
        select count(*)::bigint as gateway_count
        from public.funnel_gateway_bindings b
        where b.organization_id=rs.organization_id
          and b.funnel_id=rs.source_ref_id
          and b.status='active'
      ) gb on rs.source_type='funnel'
      where rs.organization_id=v_org
    ),
    source_rows as (
      select *
      from source_base
      order by created_at desc
      limit v_limit
    ),
    metrics as (
      select
        (select count(*)::bigint from source_base s where s.status<>'archived') as sources,
        (select count(*)::bigint from source_base s where s.onboarding_status='operational') as operational_sources,
        (select count(*)::bigint from source_base s where s.onboarding_status='awaiting_first_event') as awaiting_first_event,
        (select count(*)::bigint from source_base s where s.onboarding_status in ('needs_connection','needs_credential','needs_attention')) as sources_needing_attention,
        (select count(*)::bigint
           from public.gateways g
          where g.organization_id=v_org) as gateways,
        (select count(*)::bigint
           from public.gateways g
          where g.organization_id=v_org
            and lower(g.status) in ('connected','degraded')) as operational_gateways,
        (select count(*)::bigint
           from public.webhook_integrations w
          where w.organization_id=v_org and w.status='active') as active_webhooks,
        (select count(*)::bigint
           from public.api_keys k
          where k.organization_id=v_org
            and k.revoked_at is null
            and (k.expires_at is null or k.expires_at>now())) as active_api_keys
    )
    select jsonb_build_object(
      'metrics',(select to_jsonb(m) from metrics m),
      'sources',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',s.id,
          'source_type',s.source_type,
          'source_ref_id',s.source_ref_id,
          'name',s.name,
          'status',s.status,
          'funnel_type',s.funnel_type,
          'url',s.url,
          'connection_id',s.connection_id,
          'connection_type',s.connection_type,
          'connection_status',s.connection_status,
          'health_status',s.health_status,
          'last_error',s.last_error,
          'last_event_at',s.last_event_at,
          'event_count',s.event_count,
          'error_count',s.error_count,
          'write_enabled',s.write_enabled,
          'control_status',s.control_status,
          'capabilities',s.capabilities,
          'has_ingestion_token',s.has_ingestion_token,
          'webhook_count',s.webhook_count,
          'offer_count',s.offer_count,
          'gateway_count',s.gateway_count,
          'onboarding_status',s.onboarding_status,
          'onboarding_progress',s.onboarding_progress,
          'checklist',jsonb_build_object(
            'registered',true,
            'connection',s.connection_id is not null,
            'ingestion_ready',s.has_ingestion_token or s.webhook_count>0,
            'first_event_received',s.last_event_at is not null or s.event_count>0,
            'product_linked',s.offer_count>0,
            'gateway_linked',s.gateway_count>0,
            'remote_control_ready',s.write_enabled and s.control_status in ('ready','degraded')
          ),
          'created_at',s.created_at,
          'updated_at',s.updated_at
        ) order by s.created_at desc)
        from source_rows s
      ),'[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.integration_hub_overview_v1(integer) from public,anon;
grant execute on function public.integration_hub_overview_v1(integer) to authenticated;
