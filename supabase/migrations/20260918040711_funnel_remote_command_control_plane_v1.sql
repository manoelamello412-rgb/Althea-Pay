alter table public.funnel_connections
  add column if not exists adapter_key text not null default 'inbound_only',
  add column if not exists remote_base_url text,
  add column if not exists remote_funnel_id text,
  add column if not exists credential_secret_id uuid,
  add column if not exists capabilities jsonb not null default '["events:read"]'::jsonb,
  add column if not exists write_enabled boolean not null default false,
  add column if not exists desired_gateway_id text,
  add column if not exists observed_gateway_id text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_command_at timestamptz,
  add column if not exists control_status text not null default 'read_only';

alter table public.funnel_connections
  drop constraint if exists funnel_connections_control_status_check,
  add constraint funnel_connections_control_status_check
    check (control_status in ('read_only','ready','syncing','degraded','error')),
  drop constraint if exists funnel_connections_capabilities_array_check,
  add constraint funnel_connections_capabilities_array_check
    check (jsonb_typeof(capabilities) = 'array');

create index if not exists funnel_connections_control_idx
  on public.funnel_connections (organization_id, write_enabled, control_status);

create table if not exists public.funnel_connection_gateway_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null references public.funnel_connections(id) on delete cascade,
  funnel_id text not null references public.funnels(id) on delete cascade,
  gateway_id text not null references public.gateways(id) on delete cascade,
  remote_gateway_ref text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_connection_gateway_mappings_status_check check (status in ('active','disabled')),
  constraint funnel_connection_gateway_mappings_remote_ref_check check (length(trim(remote_gateway_ref)) between 1 and 500),
  constraint funnel_connection_gateway_mappings_unique unique (connection_id, gateway_id)
);

create index if not exists funnel_connection_gateway_mappings_org_idx
  on public.funnel_connection_gateway_mappings (organization_id, funnel_id, status);

alter table public.funnel_connection_gateway_mappings enable row level security;
revoke all on public.funnel_connection_gateway_mappings from anon;
revoke insert, update, delete on public.funnel_connection_gateway_mappings from authenticated;
grant select on public.funnel_connection_gateway_mappings to authenticated;

drop policy if exists funnel_connection_gateway_mappings_select on public.funnel_connection_gateway_mappings;
create policy funnel_connection_gateway_mappings_select
  on public.funnel_connection_gateway_mappings
  for select to authenticated
  using (private.is_org_member(organization_id));

create table if not exists public.funnel_command_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  requested_by uuid not null,
  command_type text not null default 'gateway_switch',
  target_gateway_id text references public.gateways(id) on delete restrict,
  dry_run boolean not null default false,
  allow_partial boolean not null default false,
  status text not null default 'queued',
  idempotency_key text,
  correlation_id text not null default ('ALT-CMD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  total_targets integer not null default 0,
  succeeded_targets integer not null default 0,
  failed_targets integer not null default 0,
  pending_targets integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint funnel_command_batches_type_check check (command_type in ('gateway_switch')),
  constraint funnel_command_batches_status_check check (status in ('queued','running','preflight_failed','succeeded','partial','failed','cancelled')),
  constraint funnel_command_batches_correlation_unique unique (correlation_id)
);

create unique index if not exists funnel_command_batches_idempotency_uidx
  on public.funnel_command_batches (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists funnel_command_batches_org_time_idx
  on public.funnel_command_batches (organization_id, requested_at desc);

alter table public.funnel_command_batches enable row level security;
revoke all on public.funnel_command_batches from anon;
revoke insert, update, delete on public.funnel_command_batches from authenticated;
grant select on public.funnel_command_batches to authenticated;

drop policy if exists funnel_command_batches_select on public.funnel_command_batches;
create policy funnel_command_batches_select
  on public.funnel_command_batches
  for select to authenticated
  using (private.is_org_member(organization_id));

create table if not exists public.funnel_command_targets (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.funnel_command_batches(id) on delete cascade,
  organization_id uuid not null,
  connection_id uuid references public.funnel_connections(id) on delete set null,
  funnel_id text not null references public.funnels(id) on delete cascade,
  target_gateway_id text not null references public.gateways(id) on delete restrict,
  target_remote_gateway_ref text,
  previous_gateway_id text,
  previous_remote_gateway_ref text,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  worker_id text,
  claimed_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  remote_before jsonb,
  remote_after jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  correlation_id text not null default ('ALT-TGT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  started_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_command_targets_status_check check (status in ('queued','running','retry','blocked','preflight_succeeded','verified','failed','cancelled')),
  constraint funnel_command_targets_attempts_check check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint funnel_command_targets_unique unique (batch_id, funnel_id),
  constraint funnel_command_targets_correlation_unique unique (correlation_id)
);

create index if not exists funnel_command_targets_queue_idx
  on public.funnel_command_targets (status, next_attempt_at, created_at)
  where status in ('queued','retry');

create index if not exists funnel_command_targets_batch_idx
  on public.funnel_command_targets (batch_id, status);

alter table public.funnel_command_targets enable row level security;
revoke all on public.funnel_command_targets from anon;
revoke insert, update, delete on public.funnel_command_targets from authenticated;
grant select on public.funnel_command_targets to authenticated;

drop policy if exists funnel_command_targets_select on public.funnel_command_targets;
create policy funnel_command_targets_select
  on public.funnel_command_targets
  for select to authenticated
  using (private.is_org_member(organization_id));

create or replace function public.store_funnel_connection_secret(
  p_secret text,
  p_name text default 'Althea funnel connector secret'
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare v_id uuid;
begin
  if coalesce(trim(p_secret),'') = '' then raise exception 'secret_required' using errcode='22023'; end if;
  select vault.create_secret(p_secret,p_name,'ALTHEA PAY external funnel connector credential',null) into v_id;
  return v_id;
end;
$$;

revoke all on function public.store_funnel_connection_secret(text,text) from public, anon, authenticated;
grant execute on function public.store_funnel_connection_secret(text,text) to service_role;

create or replace function public.update_funnel_connection_secret(
  p_secret_id uuid,
  p_secret text,
  p_name text default 'Althea funnel connector secret'
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare v_id uuid;
begin
  if p_secret_id is null then raise exception 'secret_id_required' using errcode='22023'; end if;
  if coalesce(trim(p_secret),'') = '' then raise exception 'secret_required' using errcode='22023'; end if;
  select vault.update_secret(p_secret_id,p_secret,p_name,'ALTHEA PAY external funnel connector credential',null) into v_id;
  return coalesce(v_id,p_secret_id);
end;
$$;

revoke all on function public.update_funnel_connection_secret(uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_funnel_connection_secret(uuid,text,text) to service_role;

create or replace function public.resolve_funnel_connection_secret(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare v_secret_id uuid; v_secret text;
begin
  select credential_secret_id into v_secret_id from public.funnel_connections where id=p_connection_id;
  if v_secret_id is null then return '{}'::jsonb; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id=v_secret_id;
  if v_secret is null then raise exception 'funnel_connection_secret_not_found' using errcode='P0002'; end if;
  begin return v_secret::jsonb;
  exception when others then raise exception 'funnel_connection_secret_invalid_json' using errcode='22023';
  end;
end;
$$;

revoke all on function public.resolve_funnel_connection_secret(uuid) from public, anon, authenticated;
grant execute on function public.resolve_funnel_connection_secret(uuid) to service_role;

create or replace function public.refresh_funnel_command_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_total integer; v_success integer; v_failed integer; v_pending integer; v_status text; v_started timestamptz;
begin
  select count(*)::int,
         count(*) filter (where status in ('verified','preflight_succeeded'))::int,
         count(*) filter (where status in ('failed','blocked','cancelled'))::int,
         count(*) filter (where status in ('queued','running','retry'))::int,
         min(started_at)
    into v_total,v_success,v_failed,v_pending,v_started
  from public.funnel_command_targets where batch_id=p_batch_id;

  if v_total=0 then v_status:='failed';
  elsif v_pending>0 then v_status:=case when v_success+v_failed>0 then 'running' else 'queued' end;
  elsif v_failed=0 then v_status:='succeeded';
  elsif v_success=0 then v_status:='failed';
  else v_status:='partial';
  end if;

  update public.funnel_command_batches
     set status=v_status,total_targets=v_total,succeeded_targets=v_success,failed_targets=v_failed,pending_targets=v_pending,
         started_at=coalesce(started_at,v_started),
         completed_at=case when v_pending=0 then coalesce(completed_at,now()) else null end,
         updated_at=now()
   where id=p_batch_id;

  return jsonb_build_object('batch_id',p_batch_id,'status',v_status,'total_targets',v_total,'succeeded_targets',v_success,'failed_targets',v_failed,'pending_targets',v_pending);
end;
$$;

revoke all on function public.refresh_funnel_command_batch(uuid) from public, anon, authenticated;
grant execute on function public.refresh_funnel_command_batch(uuid) to service_role;

create or replace function public.request_global_funnel_gateway_switch(
  p_gateway_id text,
  p_dry_run boolean default true,
  p_allow_partial boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_user uuid:=auth.uid(); v_org uuid; v_batch uuid; v_existing uuid; v_total integer:=0; v_blocked integer:=0;
begin
  if v_user is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if coalesce(trim(p_gateway_id),'')='' then raise exception 'gateway_id_required' using errcode='22023'; end if;

  select organization_id into v_org from public.gateways
   where id=p_gateway_id and lower(coalesce(status,'')) in ('connected','degraded');
  if v_org is null then raise exception 'gateway_not_operational' using errcode='P0002'; end if;
  if not private.has_org_role(v_org,array['owner','admin','manager','operator','supervisor']) then raise exception 'forbidden' using errcode='42501'; end if;

  if nullif(trim(coalesce(p_idempotency_key,'')),'') is not null then
    select id into v_existing from public.funnel_command_batches
     where organization_id=v_org and idempotency_key=trim(p_idempotency_key) limit 1;
    if v_existing is not null then
      return (select jsonb_build_object('batch_id',id,'correlation_id',correlation_id,'status',status,'total_targets',total_targets,'succeeded_targets',succeeded_targets,'failed_targets',failed_targets,'pending_targets',pending_targets,'duplicate',true) from public.funnel_command_batches where id=v_existing);
    end if;
  end if;

  insert into public.funnel_command_batches(organization_id,requested_by,target_gateway_id,dry_run,allow_partial,idempotency_key,status)
  values(v_org,v_user,p_gateway_id,coalesce(p_dry_run,true),coalesce(p_allow_partial,false),nullif(trim(coalesce(p_idempotency_key,'')),''),'queued')
  returning id into v_batch;

  insert into public.funnel_command_targets(batch_id,organization_id,connection_id,funnel_id,target_gateway_id,target_remote_gateway_ref,previous_gateway_id,status,last_error_code,last_error_message)
  select v_batch,f.organization_id,fc.id,f.id,p_gateway_id,m.remote_gateway_ref,oldb.gateway_id,
    case
      when fc.id is null then 'blocked'
      when fc.status<>'active' then 'blocked'
      when fc.write_enabled is not true then 'blocked'
      when fc.control_status not in ('ready','degraded') then 'blocked'
      when not (fc.capabilities ? 'gateway:read') then 'blocked'
      when not (fc.capabilities ? 'gateway:write') then 'blocked'
      when m.remote_gateway_ref is null then 'blocked'
      else 'queued'
    end,
    case
      when fc.id is null then 'funnel_connection_missing'
      when fc.status<>'active' then 'funnel_connection_inactive'
      when fc.write_enabled is not true then 'funnel_write_not_enabled'
      when fc.control_status not in ('ready','degraded') then 'funnel_control_not_ready'
      when not (fc.capabilities ? 'gateway:read') then 'gateway_read_unsupported'
      when not (fc.capabilities ? 'gateway:write') then 'gateway_write_unsupported'
      when m.remote_gateway_ref is null then 'remote_gateway_mapping_missing'
      else null
    end,
    case
      when fc.id is null then 'Funil sem conexão remota ativa.'
      when fc.status<>'active' then 'Conexão do funil não está ativa.'
      when fc.write_enabled is not true then 'Escrita remota não foi habilitada para este funil.'
      when fc.control_status not in ('ready','degraded') then 'Controle remoto do funil não está pronto.'
      when not (fc.capabilities ? 'gateway:read') then 'Conector não suporta leitura da gateway atual.'
      when not (fc.capabilities ? 'gateway:write') then 'Conector não suporta troca remota de gateway.'
      when m.remote_gateway_ref is null then 'Gateway ainda não possui referência remota mapeada neste funil.'
      else null
    end
  from public.funnels f
  left join lateral (
    select x.* from public.funnel_connections x
     where x.funnel_id=f.id and x.organization_id=f.organization_id order by x.created_at limit 1
  ) fc on true
  left join public.funnel_connection_gateway_mappings m
    on m.connection_id=fc.id and m.gateway_id=p_gateway_id and m.status='active'
  left join lateral (
    select b.gateway_id from public.funnel_gateway_bindings b
     where b.organization_id=f.organization_id and b.funnel_id=f.id and b.is_primary=true and b.status='active'
     order by b.updated_at desc limit 1
  ) oldb on true
  where f.organization_id=v_org and f.deleted_at is null;

  select count(*)::int,count(*) filter(where status='blocked')::int into v_total,v_blocked
  from public.funnel_command_targets where batch_id=v_batch;

  if v_total=0 then
    update public.funnel_command_batches set status='failed',completed_at=now(),metadata=jsonb_build_object('reason','no_funnels_found'),updated_at=now() where id=v_batch;
  elsif v_blocked>0 and not coalesce(p_allow_partial,false) and not coalesce(p_dry_run,true) then
    update public.funnel_command_targets
       set status='blocked',
           last_error_code=coalesce(last_error_code,'global_preflight_incomplete'),
           last_error_message=coalesce(last_error_message,'Execução bloqueada porque nem todos os funis estão prontos. Execute a simulação e corrija os bloqueios.'),
           updated_at=now()
     where batch_id=v_batch and status='queued';
    update public.funnel_command_batches set status='preflight_failed',completed_at=now(),updated_at=now() where id=v_batch;
  end if;

  perform public.refresh_funnel_command_batch(v_batch);
  if v_blocked>0 and not coalesce(p_allow_partial,false) and not coalesce(p_dry_run,true) then
    update public.funnel_command_batches set status='preflight_failed',updated_at=now() where id=v_batch;
  end if;

  return (select jsonb_build_object('batch_id',id,'correlation_id',correlation_id,'status',status,'dry_run',dry_run,'total_targets',total_targets,'succeeded_targets',succeeded_targets,'failed_targets',failed_targets,'pending_targets',pending_targets,'blocked_targets',v_blocked) from public.funnel_command_batches where id=v_batch);
end;
$$;

revoke all on function public.request_global_funnel_gateway_switch(text,boolean,boolean,text) from public, anon;
grant execute on function public.request_global_funnel_gateway_switch(text,boolean,boolean,text) to authenticated;

create or replace function public.claim_funnel_command_targets(p_worker_id text,p_limit integer default 20)
returns setof public.funnel_command_targets
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(trim(p_worker_id),'')='' then raise exception 'worker_id_required' using errcode='22023'; end if;
  return query
  with candidates as (
    select t.id from public.funnel_command_targets t
    join public.funnel_command_batches b on b.id=t.batch_id
    where t.status in ('queued','retry')
      and b.status not in ('cancelled','preflight_failed','failed')
      and (t.next_attempt_at is null or t.next_attempt_at<=now())
    order by t.created_at
    for update of t skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.funnel_command_targets t
     set status='running',worker_id=p_worker_id,claimed_at=now(),started_at=coalesce(started_at,now()),attempt_count=attempt_count+1,updated_at=now()
    from candidates c
   where t.id=c.id
  returning t.*;
end;
$$;

revoke all on function public.claim_funnel_command_targets(text,integer) from public, anon, authenticated;
grant execute on function public.claim_funnel_command_targets(text,integer) to service_role;

create or replace function public.complete_funnel_command_preflight(
  p_target_id uuid,
  p_observed_remote_gateway_ref text,
  p_remote_before jsonb default '{}'::jsonb,
  p_result_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_batch uuid;
begin
  update public.funnel_command_targets
     set status='preflight_succeeded',previous_remote_gateway_ref=nullif(trim(coalesce(p_observed_remote_gateway_ref,'')),''),
         remote_before=coalesce(p_remote_before,'{}'::jsonb),result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_result_payload,'{}'::jsonb),
         verified_at=now(),completed_at=now(),claimed_at=null,worker_id=null,last_error_code=null,last_error_message=null,updated_at=now()
   where id=p_target_id and status='running'
   returning batch_id into v_batch;
  if v_batch is null then raise exception 'target_not_running' using errcode='55000'; end if;
  return public.refresh_funnel_command_batch(v_batch);
end;
$$;

revoke all on function public.complete_funnel_command_preflight(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.complete_funnel_command_preflight(uuid,text,jsonb,jsonb) to service_role;

create or replace function public.finalize_funnel_gateway_switch_target(
  p_target_id uuid,
  p_observed_before text,
  p_observed_after text,
  p_remote_before jsonb default '{}'::jsonb,
  p_remote_after jsonb default '{}'::jsonb,
  p_result_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_target public.funnel_command_targets%rowtype;
begin
  select * into v_target from public.funnel_command_targets where id=p_target_id for update;
  if not found or v_target.status<>'running' then raise exception 'target_not_running' using errcode='55000'; end if;
  if nullif(trim(coalesce(p_observed_after,'')),'') is distinct from v_target.target_remote_gateway_ref then
    raise exception 'remote_gateway_verification_failed' using errcode='55000';
  end if;

  update public.funnel_gateway_bindings set is_primary=false,updated_at=now()
   where organization_id=v_target.organization_id and funnel_id=v_target.funnel_id and is_primary=true and gateway_id<>v_target.target_gateway_id;

  insert into public.funnel_gateway_bindings(organization_id,funnel_id,gateway_id,role,priority,is_primary,status)
  values(v_target.organization_id,v_target.funnel_id,v_target.target_gateway_id,'payment',1,true,'active')
  on conflict (funnel_id,gateway_id) do update
    set organization_id=excluded.organization_id,role='payment',priority=1,is_primary=true,status='active',updated_at=now();

  update public.funnel_connections
     set desired_gateway_id=v_target.target_gateway_id,observed_gateway_id=v_target.target_gateway_id,last_verified_at=now(),last_command_at=now(),control_status='ready',last_error=null,updated_at=now()
   where id=v_target.connection_id and organization_id=v_target.organization_id;

  update public.funnel_command_targets
     set status='verified',previous_remote_gateway_ref=nullif(trim(coalesce(p_observed_before,'')),''),
         remote_before=coalesce(p_remote_before,'{}'::jsonb),remote_after=coalesce(p_remote_after,'{}'::jsonb),
         result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_result_payload,'{}'::jsonb),
         verified_at=now(),completed_at=now(),claimed_at=null,worker_id=null,last_error_code=null,last_error_message=null,updated_at=now()
   where id=p_target_id;

  return public.refresh_funnel_command_batch(v_target.batch_id);
end;
$$;

revoke all on function public.finalize_funnel_gateway_switch_target(uuid,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_funnel_gateway_switch_target(uuid,text,text,jsonb,jsonb,jsonb) to service_role;

create or replace function public.fail_funnel_command_target(
  p_target_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default false,
  p_remote_before jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_target public.funnel_command_targets%rowtype; v_status text; v_next timestamptz;
begin
  select * into v_target from public.funnel_command_targets where id=p_target_id for update;
  if not found then raise exception 'target_not_found' using errcode='P0002'; end if;

  if coalesce(p_retryable,false) and v_target.attempt_count<v_target.max_attempts then
    v_status:='retry';
    v_next:=now()+make_interval(secs=>least(300,greatest(5,(power(2,greatest(v_target.attempt_count,1))::int)*5)));
  else
    v_status:='failed'; v_next:=null;
  end if;

  update public.funnel_command_targets
     set status=v_status,next_attempt_at=v_next,
         last_error_code=left(coalesce(nullif(trim(p_error_code),''),'remote_command_failed'),120),
         last_error_message=left(coalesce(nullif(trim(p_error_message),''),'Falha ao executar comando remoto.'),2000),
         remote_before=coalesce(p_remote_before,remote_before),claimed_at=null,worker_id=null,
         completed_at=case when v_status='failed' then now() else null end,updated_at=now()
   where id=p_target_id;

  if v_status='failed' and v_target.connection_id is not null then
    update public.funnel_connections
       set control_status='degraded',last_error=left(coalesce(nullif(trim(p_error_message),''),'Falha ao executar comando remoto.'),2000),last_command_at=now(),updated_at=now()
     where id=v_target.connection_id;
  end if;

  return public.refresh_funnel_command_batch(v_target.batch_id);
end;
$$;

revoke all on function public.fail_funnel_command_target(uuid,text,text,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.fail_funnel_command_target(uuid,text,text,boolean,jsonb) to service_role;
