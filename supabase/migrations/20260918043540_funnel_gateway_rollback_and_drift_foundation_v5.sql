alter table public.funnel_command_batches
  drop constraint if exists funnel_command_batches_type_check,
  add constraint funnel_command_batches_type_check
    check (command_type in ('gateway_switch','gateway_rollback'));

create table if not exists public.funnel_control_drift_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null references public.funnel_connections(id) on delete cascade,
  funnel_id text not null references public.funnels(id) on delete cascade,
  expected_gateway_id text references public.gateways(id) on delete set null,
  observed_gateway_id text references public.gateways(id) on delete set null,
  observed_remote_gateway_ref text,
  status text not null default 'open',
  correlation_id text not null default ('ALT-DRIFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_control_drift_events_status_check check (status in ('open','resolved')),
  constraint funnel_control_drift_events_correlation_unique unique (correlation_id)
);

create unique index if not exists funnel_control_drift_open_uidx
  on public.funnel_control_drift_events(connection_id)
  where status='open';

create index if not exists funnel_control_drift_org_time_idx
  on public.funnel_control_drift_events(organization_id,detected_at desc);

alter table public.funnel_control_drift_events enable row level security;
revoke all on public.funnel_control_drift_events from anon;
revoke insert,update,delete on public.funnel_control_drift_events from authenticated;
grant select on public.funnel_control_drift_events to authenticated;

drop policy if exists funnel_control_drift_events_select on public.funnel_control_drift_events;
create policy funnel_control_drift_events_select
  on public.funnel_control_drift_events
  for select to authenticated
  using (private.is_org_member(organization_id));

create or replace function public.request_funnel_gateway_rollback(
  p_batch_id uuid,
  p_allow_partial boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid;
  v_original_status text;
  v_new_batch uuid;
  v_existing uuid;
  v_total integer:=0;
  v_blocked integer:=0;
begin
  if v_user is null then raise exception 'unauthorized' using errcode='42501'; end if;

  select organization_id,status into v_org,v_original_status
  from public.funnel_command_batches
  where id=p_batch_id
    and command_type in ('gateway_switch','gateway_rollback');

  if v_org is null then raise exception 'batch_not_found' using errcode='P0002'; end if;
  if v_original_status not in ('succeeded','partial') then
    raise exception 'batch_not_rollbackable' using errcode='55000';
  end if;
  if not private.has_org_role(v_org,array['owner','admin','manager','operator','supervisor']) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_idempotency_key,'')),'') is not null then
    select id into v_existing
    from public.funnel_command_batches
    where organization_id=v_org and idempotency_key=trim(p_idempotency_key)
    limit 1;
    if v_existing is not null then
      return (
        select jsonb_build_object(
          'batch_id',id,'correlation_id',correlation_id,'status',status,
          'total_targets',total_targets,'succeeded_targets',succeeded_targets,
          'failed_targets',failed_targets,'pending_targets',pending_targets,'duplicate',true
        )
        from public.funnel_command_batches where id=v_existing
      );
    end if;
  end if;

  insert into public.funnel_command_batches(
    organization_id,requested_by,command_type,target_gateway_id,dry_run,allow_partial,
    idempotency_key,status,metadata
  )
  values(
    v_org,v_user,'gateway_rollback',null,false,coalesce(p_allow_partial,false),
    nullif(trim(coalesce(p_idempotency_key,'')),''),
    'queued',jsonb_build_object('phase','preflight','rollback_of',p_batch_id)
  )
  returning id into v_new_batch;

  insert into public.funnel_command_targets(
    batch_id,organization_id,connection_id,funnel_id,target_gateway_id,
    target_remote_gateway_ref,previous_gateway_id,status,last_error_code,last_error_message
  )
  select
    v_new_batch,
    t.organization_id,
    t.connection_id,
    t.funnel_id,
    coalesce(t.previous_gateway_id,t.target_gateway_id),
    t.previous_remote_gateway_ref,
    t.target_gateway_id,
    case
      when t.previous_gateway_id is null then 'blocked'
      when nullif(trim(coalesce(t.previous_remote_gateway_ref,'')),'') is null then 'blocked'
      else 'queued'
    end,
    case
      when t.previous_gateway_id is null then 'rollback_previous_gateway_missing'
      when nullif(trim(coalesce(t.previous_remote_gateway_ref,'')),'') is null then 'rollback_previous_remote_ref_missing'
      else null
    end,
    case
      when t.previous_gateway_id is null then 'A gateway anterior não foi registrada para este funil.'
      when nullif(trim(coalesce(t.previous_remote_gateway_ref,'')),'') is null then 'O identificador remoto anterior não foi registrado para este funil.'
      else null
    end
  from public.funnel_command_targets t
  where t.batch_id=p_batch_id
    and t.status='verified';

  select count(*)::int,count(*) filter(where status='blocked')::int
    into v_total,v_blocked
  from public.funnel_command_targets
  where batch_id=v_new_batch;

  if v_total=0 then
    update public.funnel_command_batches
       set status='failed',completed_at=now(),
           metadata=metadata||jsonb_build_object('reason','no_verified_targets_to_rollback'),
           updated_at=now()
     where id=v_new_batch;
  elsif v_blocked>0 and not coalesce(p_allow_partial,false) then
    update public.funnel_command_targets
       set status='blocked',
           last_error_code=coalesce(last_error_code,'rollback_preflight_incomplete'),
           last_error_message=coalesce(last_error_message,'Rollback bloqueado porque nem todos os funis possuem estado anterior verificável.'),
           updated_at=now()
     where batch_id=v_new_batch and status='queued';

    update public.funnel_command_batches
       set status='preflight_failed',completed_at=now(),updated_at=now()
     where id=v_new_batch;
  else
    perform public.refresh_funnel_command_batch(v_new_batch);
  end if;

  return (
    select jsonb_build_object(
      'batch_id',id,'correlation_id',correlation_id,'status',status,
      'total_targets',total_targets,'succeeded_targets',succeeded_targets,
      'failed_targets',failed_targets,'pending_targets',pending_targets,
      'blocked_targets',v_blocked,'rollback_of',p_batch_id
    )
    from public.funnel_command_batches where id=v_new_batch
  );
end;
$$;

revoke all on function public.request_funnel_gateway_rollback(uuid,boolean,text) from public,anon;
grant execute on function public.request_funnel_gateway_rollback(uuid,boolean,text) to authenticated;
