create unique index if not exists funnel_connection_gateway_mappings_remote_uidx
  on public.funnel_connection_gateway_mappings(connection_id,remote_gateway_ref)
  where status='active';

alter table public.funnel_connections
  drop constraint if exists funnel_connections_remote_base_https_check,
  add constraint funnel_connections_remote_base_https_check
    check (remote_base_url is null or remote_base_url ~ '^https://');

alter table public.funnel_command_batches
  drop constraint if exists funnel_command_batches_counts_check,
  add constraint funnel_command_batches_counts_check
    check (
      total_targets >= 0 and succeeded_targets >= 0 and
      failed_targets >= 0 and pending_targets >= 0
    );

alter table public.funnel_command_targets
  drop constraint if exists funnel_command_targets_remote_ref_state_check,
  add constraint funnel_command_targets_remote_ref_state_check
    check (
      status in ('blocked','failed','cancelled')
      or nullif(trim(coalesce(target_remote_gateway_ref,'')),'') is not null
    );

create or replace function public.enforce_funnel_control_tenant_integrity()
returns trigger
language plpgsql
set search_path=public,pg_catalog
as $$
declare
  v_connection_org uuid;
  v_connection_funnel text;
  v_funnel_org uuid;
  v_gateway_org uuid;
  v_batch_org uuid;
begin
  if tg_table_name='funnel_connection_gateway_mappings' then
    select organization_id,funnel_id into v_connection_org,v_connection_funnel
    from public.funnel_connections where id=new.connection_id;
    select organization_id into v_funnel_org from public.funnels where id=new.funnel_id;
    select organization_id into v_gateway_org from public.gateways where id=new.gateway_id;

    if v_connection_org is null or v_funnel_org is null or v_gateway_org is null
       or v_connection_org<>new.organization_id
       or v_funnel_org<>new.organization_id
       or v_gateway_org<>new.organization_id
       or v_connection_funnel<>new.funnel_id then
      raise exception 'funnel_gateway_mapping_tenant_mismatch' using errcode='23514';
    end if;
    return new;
  end if;

  if tg_table_name='funnel_command_targets' then
    select organization_id into v_batch_org from public.funnel_command_batches where id=new.batch_id;
    select organization_id into v_funnel_org from public.funnels where id=new.funnel_id;
    select organization_id into v_gateway_org from public.gateways where id=new.target_gateway_id;

    if new.connection_id is not null then
      select organization_id,funnel_id into v_connection_org,v_connection_funnel
      from public.funnel_connections where id=new.connection_id;
    else
      v_connection_org:=new.organization_id;
      v_connection_funnel:=new.funnel_id;
    end if;

    if v_batch_org is null or v_funnel_org is null or v_gateway_org is null
       or v_batch_org<>new.organization_id
       or v_funnel_org<>new.organization_id
       or v_gateway_org<>new.organization_id
       or v_connection_org<>new.organization_id
       or v_connection_funnel<>new.funnel_id then
      raise exception 'funnel_command_target_tenant_mismatch' using errcode='23514';
    end if;
    return new;
  end if;

  if tg_table_name='funnel_control_drift_events' then
    select organization_id,funnel_id into v_connection_org,v_connection_funnel
    from public.funnel_connections where id=new.connection_id;
    select organization_id into v_funnel_org from public.funnels where id=new.funnel_id;

    if new.expected_gateway_id is not null then
      select organization_id into v_gateway_org from public.gateways where id=new.expected_gateway_id;
      if v_gateway_org is distinct from new.organization_id then
        raise exception 'funnel_drift_expected_gateway_tenant_mismatch' using errcode='23514';
      end if;
    end if;

    if new.observed_gateway_id is not null then
      select organization_id into v_gateway_org from public.gateways where id=new.observed_gateway_id;
      if v_gateway_org is distinct from new.organization_id then
        raise exception 'funnel_drift_observed_gateway_tenant_mismatch' using errcode='23514';
      end if;
    end if;

    if v_connection_org is null or v_funnel_org is null
       or v_connection_org<>new.organization_id
       or v_funnel_org<>new.organization_id
       or v_connection_funnel<>new.funnel_id then
      raise exception 'funnel_drift_tenant_mismatch' using errcode='23514';
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists funnel_gateway_mapping_tenant_integrity on public.funnel_connection_gateway_mappings;
create trigger funnel_gateway_mapping_tenant_integrity
before insert or update on public.funnel_connection_gateway_mappings
for each row execute function public.enforce_funnel_control_tenant_integrity();

drop trigger if exists funnel_command_target_tenant_integrity on public.funnel_command_targets;
create trigger funnel_command_target_tenant_integrity
before insert or update on public.funnel_command_targets
for each row execute function public.enforce_funnel_control_tenant_integrity();

drop trigger if exists funnel_drift_tenant_integrity on public.funnel_control_drift_events;
create trigger funnel_drift_tenant_integrity
before insert or update on public.funnel_control_drift_events
for each row execute function public.enforce_funnel_control_tenant_integrity();

revoke execute on function public.enforce_funnel_control_tenant_integrity() from public,anon,authenticated;
