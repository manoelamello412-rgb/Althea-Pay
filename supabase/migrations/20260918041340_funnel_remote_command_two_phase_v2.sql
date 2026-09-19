
create or replace function public.refresh_funnel_command_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total integer;
  v_preflight integer;
  v_verified integer;
  v_failed integer;
  v_pending integer;
  v_status text;
  v_started timestamptz;
  v_dry_run boolean;
  v_phase text;
  v_allow_partial boolean;
begin
  select dry_run,coalesce(metadata->>'phase','preflight'),allow_partial
    into v_dry_run,v_phase,v_allow_partial
  from public.funnel_command_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'batch_not_found' using errcode='P0002'; end if;

  select count(*)::int,
         count(*) filter (where status='preflight_succeeded')::int,
         count(*) filter (where status='verified')::int,
         count(*) filter (where status in ('failed','blocked','cancelled'))::int,
         count(*) filter (where status in ('queued','running','retry'))::int,
         min(started_at)
    into v_total,v_preflight,v_verified,v_failed,v_pending,v_started
  from public.funnel_command_targets
  where batch_id=p_batch_id;

  if v_total=0 then
    v_status:='failed';
  elsif v_phase='preflight' then
    if v_pending>0 then
      v_status:=case when v_preflight+v_failed>0 then 'running' else 'queued' end;
    elsif v_failed>0 and not v_allow_partial then
      v_status:='preflight_failed';
    elsif v_preflight>0 and not v_dry_run then
      update public.funnel_command_targets
         set status='queued',
             attempt_count=0,
             worker_id=null,
             claimed_at=null,
             next_attempt_at=null,
             started_at=null,
             verified_at=null,
             completed_at=null,
             last_error_code=null,
             last_error_message=null,
             updated_at=now()
       where batch_id=p_batch_id
         and status='preflight_succeeded';

      update public.funnel_command_batches
         set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phase','execute','preflight_completed_at',now()),
             status='queued',
             succeeded_targets=0,
             failed_targets=v_failed,
             pending_targets=v_preflight,
             started_at=null,
             completed_at=null,
             updated_at=now()
       where id=p_batch_id;

      return jsonb_build_object(
        'batch_id',p_batch_id,'status','queued','phase','execute',
        'total_targets',v_total,'succeeded_targets',0,'failed_targets',v_failed,'pending_targets',v_preflight
      );
    elsif v_failed=0 then
      v_status:='succeeded';
    elsif v_preflight=0 then
      v_status:='failed';
    else
      v_status:='partial';
    end if;
  else
    if v_pending>0 then
      v_status:=case when v_verified+v_failed>0 then 'running' else 'queued' end;
    elsif v_failed=0 then
      v_status:='succeeded';
    elsif v_verified=0 then
      v_status:='failed';
    else
      v_status:='partial';
    end if;
  end if;

  update public.funnel_command_batches
     set status=v_status,
         total_targets=v_total,
         succeeded_targets=case when v_phase='preflight' then v_preflight else v_verified end,
         failed_targets=v_failed,
         pending_targets=v_pending,
         started_at=coalesce(started_at,v_started),
         completed_at=case when v_pending=0 then coalesce(completed_at,now()) else null end,
         updated_at=now()
   where id=p_batch_id;

  return jsonb_build_object(
    'batch_id',p_batch_id,'status',v_status,'phase',v_phase,
    'total_targets',v_total,
    'succeeded_targets',case when v_phase='preflight' then v_preflight else v_verified end,
    'failed_targets',v_failed,'pending_targets',v_pending
  );
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

  select organization_id into v_org
  from public.gateways
  where id=p_gateway_id
    and lower(coalesce(status,'')) in ('connected','degraded');

  if v_org is null then raise exception 'gateway_not_operational' using errcode='P0002'; end if;
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
          'dry_run',dry_run,'phase',coalesce(metadata->>'phase','preflight'),
          'total_targets',total_targets,'succeeded_targets',succeeded_targets,
          'failed_targets',failed_targets,'pending_targets',pending_targets,'duplicate',true
        )
        from public.funnel_command_batches where id=v_existing
      );
    end if;
  end if;

  insert into public.funnel_command_batches(
    organization_id,requested_by,target_gateway_id,dry_run,allow_partial,idempotency_key,status,metadata
  )
  values(
    v_org,v_user,p_gateway_id,coalesce(p_dry_run,true),coalesce(p_allow_partial,false),
    nullif(trim(coalesce(p_idempotency_key,'')),''),
    'queued',jsonb_build_object('phase','preflight')
  )
  returning id into v_batch;

  insert into public.funnel_command_targets(
    batch_id,organization_id,connection_id,funnel_id,target_gateway_id,
    target_remote_gateway_ref,previous_gateway_id,status,last_error_code,last_error_message
  )
  select
    v_batch,f.organization_id,fc.id,f.id,p_gateway_id,m.remote_gateway_ref,oldb.gateway_id,
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
    where x.funnel_id=f.id and x.organization_id=f.organization_id
    order by x.created_at limit 1
  ) fc on true
  left join public.funnel_connection_gateway_mappings m
    on m.connection_id=fc.id and m.gateway_id=p_gateway_id and m.status='active'
  left join lateral (
    select b.gateway_id from public.funnel_gateway_bindings b
    where b.organization_id=f.organization_id and b.funnel_id=f.id and b.is_primary=true and b.status='active'
    order by b.updated_at desc limit 1
  ) oldb on true
  where f.organization_id=v_org and f.deleted_at is null;

  select count(*)::int,count(*) filter(where status='blocked')::int
    into v_total,v_blocked
  from public.funnel_command_targets
  where batch_id=v_batch;

  if v_total=0 then
    update public.funnel_command_batches
       set status='failed',completed_at=now(),metadata=metadata||jsonb_build_object('reason','no_funnels_found'),updated_at=now()
     where id=v_batch;
  elsif v_blocked>0 and not coalesce(p_allow_partial,false) then
    update public.funnel_command_targets
       set status='blocked',
           last_error_code=coalesce(last_error_code,'global_preflight_incomplete'),
           last_error_message=coalesce(last_error_message,'Operação bloqueada porque nem todos os funis estão prontos para controle remoto.'),
           updated_at=now()
     where batch_id=v_batch and status='queued';

    update public.funnel_command_batches
       set status='preflight_failed',completed_at=now(),updated_at=now()
     where id=v_batch;
  else
    perform public.refresh_funnel_command_batch(v_batch);
  end if;

  return (
    select jsonb_build_object(
      'batch_id',id,'correlation_id',correlation_id,'status',status,
      'dry_run',dry_run,'phase',coalesce(metadata->>'phase','preflight'),
      'total_targets',total_targets,'succeeded_targets',succeeded_targets,
      'failed_targets',failed_targets,'pending_targets',pending_targets,
      'blocked_targets',v_blocked
    )
    from public.funnel_command_batches where id=v_batch
  );
end;
$$;

revoke all on function public.request_global_funnel_gateway_switch(text,boolean,boolean,text) from public, anon;
grant execute on function public.request_global_funnel_gateway_switch(text,boolean,boolean,text) to authenticated;
