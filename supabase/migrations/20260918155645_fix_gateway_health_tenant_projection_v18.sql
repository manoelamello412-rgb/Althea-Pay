
create or replace function public.record_gateway_health(
  p_gateway_id uuid,
  p_gateway_name text,
  p_success boolean,
  p_latency_ms integer default null
)
returns public.gateway_health_snapshots
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v public.gateway_health_snapshots;
  failures integer;
  state text;
  v_user_id uuid;
  v_gateway_name text;
begin
  select g.user_id, coalesce(nullif(p_gateway_name,''), g.provider)
    into v_user_id, v_gateway_name
  from public.gateways g
  where g.circuit_id = p_gateway_id;

  if v_user_id is null then
    raise exception 'gateway_health_gateway_not_found';
  end if;

  select hs.consecutive_failures
    into failures
  from public.gateway_health_snapshots hs
  where hs.gateway_id = p_gateway_id
    and hs.user_id = v_user_id
  order by hs.checked_at desc
  limit 1;

  failures := case when p_success then 0 else coalesce(failures,0)+1 end;
  state := case
    when failures >= 5 then 'open'
    when failures >= 3 then 'half_open'
    else 'closed'
  end;

  insert into public.gateway_health_snapshots(
    user_id,gateway_id,gateway_name,is_healthy,latency_ms,
    consecutive_failures,circuit_state,details
  )
  values(
    v_user_id,p_gateway_id,v_gateway_name,p_success,p_latency_ms,
    failures,state,jsonb_build_object('source','transaction_core','threshold',5)
  )
  returning * into v;

  return v;
end;
$$;

revoke all on function public.record_gateway_health(uuid,text,boolean,integer)
from public,anon,authenticated;
grant execute on function public.record_gateway_health(uuid,text,boolean,integer)
to service_role;

update public.gateway_health_snapshots hs
set user_id=g.user_id
from public.gateways g
where hs.user_id is null
  and hs.gateway_id=g.circuit_id;

do $$
begin
  if exists(select 1 from public.gateway_health_snapshots where user_id is null) then
    raise exception 'gateway_health_orphan_snapshot';
  end if;
end $$;

alter table public.gateway_health_snapshots
  alter column user_id set not null;

grant select on public.gateway_health_snapshots to authenticated;

create index if not exists gateway_health_snapshots_user_gateway_checked_idx
  on public.gateway_health_snapshots(user_id,gateway_id,checked_at desc);
