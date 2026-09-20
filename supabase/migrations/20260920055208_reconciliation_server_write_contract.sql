-- Canonical server-side reconciliation write contract.
-- Versioned only. Do not apply without explicit authorization.

do $guard$
begin
  if to_regclass('public.reconciliation_runs') is null
     or to_regclass('public.reconciliation_items') is null
     or to_regclass('public.gateways') is null
     or to_regclass('public.gateway_transactions') is null then
    raise exception 'reconciliation_contract_guard: required tables are missing';
  end if;

  if has_table_privilege('service_role','public.reconciliation_runs','INSERT')
     or has_table_privilege('service_role','public.reconciliation_runs','UPDATE')
     or has_table_privilege('service_role','public.reconciliation_items','INSERT')
     or has_table_privilege('service_role','public.reconciliation_items','UPDATE') then
    raise exception 'reconciliation_contract_guard: broad service_role reconciliation DML already exists';
  end if;
end
$guard$;

create or replace function public.server_create_reconciliation_run_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_gateway_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_source_type text default 'gateway_api',
  p_source_reference text default null,
  p_started_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_user_id is null or p_organization_id is null or nullif(btrim(p_gateway_id),'') is null then
    raise exception 'reconciliation_tenant_context_required' using errcode='22023';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid_reconciliation_period' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.gateways g
    where g.id=p_gateway_id and g.user_id=p_user_id and g.organization_id=p_organization_id
  ) then
    raise exception 'reconciliation_gateway_tenant_mismatch' using errcode='42501';
  end if;

  insert into public.reconciliation_runs(
    user_id,organization_id,gateway_id,period_start,period_end,status,
    source_type,source_reference,started_at
  ) values (
    p_user_id,p_organization_id,p_gateway_id,p_period_start,p_period_end,'running',
    coalesce(nullif(btrim(p_source_type),''),'gateway_api'),p_source_reference,coalesce(p_started_at,now())
  ) returning id into v_id;

  return v_id;
end
$function$;

revoke all on function public.server_create_reconciliation_run_v1(
  uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.server_create_reconciliation_run_v1(
  uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz
) to service_role;

create or replace function public.server_insert_reconciliation_item_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_run_id uuid,
  p_transaction_id uuid default null,
  p_external_transaction_id text default null,
  p_status text default 'unmatched',
  p_expected_amount numeric default null,
  p_reported_amount numeric default null,
  p_discrepancy_amount numeric default null,
  p_mismatch_reason text default null,
  p_gateway_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_gateway_id text;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_user_id is null or p_organization_id is null or p_run_id is null then
    raise exception 'reconciliation_item_tenant_context_required' using errcode='22023';
  end if;

  select r.gateway_id into v_gateway_id
  from public.reconciliation_runs r
  where r.id=p_run_id and r.user_id=p_user_id and r.organization_id=p_organization_id;
  if not found then
    raise exception 'reconciliation_run_tenant_mismatch' using errcode='42501';
  end if;

  if p_transaction_id is not null and not exists (
    select 1 from public.gateway_transactions t
    where t.id=p_transaction_id
      and t.user_id=p_user_id
      and t.organization_id=p_organization_id
      and (v_gateway_id is null or t.gateway_id=v_gateway_id)
  ) then
    raise exception 'reconciliation_transaction_tenant_mismatch' using errcode='42501';
  end if;

  insert into public.reconciliation_items(
    user_id,organization_id,run_id,transaction_id,external_transaction_id,status,
    expected_amount,reported_amount,discrepancy_amount,mismatch_reason,gateway_payload
  ) values (
    p_user_id,p_organization_id,p_run_id,p_transaction_id,p_external_transaction_id,
    coalesce(nullif(btrim(p_status),''),'unmatched'),
    p_expected_amount,p_reported_amount,p_discrepancy_amount,p_mismatch_reason,
    coalesce(p_gateway_payload,'{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end
$function$;

revoke all on function public.server_insert_reconciliation_item_v1(
  uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,jsonb
) from public, anon, authenticated;
grant execute on function public.server_insert_reconciliation_item_v1(
  uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,jsonb
) to service_role;

create or replace function public.server_finish_reconciliation_run_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_matched_count integer default 0,
  p_mismatch_count integer default 0,
  p_gross_expected numeric default 0,
  p_gross_reported numeric default 0,
  p_discrepancy_amount numeric default 0,
  p_error_message text default null,
  p_completed_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_current_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_user_id is null or p_organization_id is null or p_run_id is null then
    raise exception 'reconciliation_finish_tenant_context_required' using errcode='22023';
  end if;
  if p_status not in ('completed','failed') then
    raise exception 'invalid_reconciliation_terminal_status' using errcode='22023';
  end if;

  select status into v_current_status
  from public.reconciliation_runs
  where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id
  for update;

  if not found then return false; end if;
  if v_current_status <> 'running' then return false; end if;

  update public.reconciliation_runs
  set status=p_status,
      matched_count=greatest(coalesce(p_matched_count,0),0),
      mismatch_count=greatest(coalesce(p_mismatch_count,0),0),
      gross_expected=greatest(coalesce(p_gross_expected,0),0),
      gross_reported=greatest(coalesce(p_gross_reported,0),0),
      fees_expected=0,
      fees_reported=0,
      net_expected=greatest(coalesce(p_gross_expected,0),0),
      net_reported=greatest(coalesce(p_gross_reported,0),0),
      discrepancy_amount=coalesce(p_discrepancy_amount,0),
      error_message=case when p_status='failed' then left(p_error_message,2000) else null end,
      completed_at=coalesce(p_completed_at,now()),
      updated_at=now()
  where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id;

  return true;
end
$function$;

revoke all on function public.server_finish_reconciliation_run_v1(
  uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.server_finish_reconciliation_run_v1(
  uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,text,timestamptz
) to service_role;

do $post_guard$
begin
  if has_table_privilege('service_role','public.reconciliation_runs','INSERT')
     or has_table_privilege('service_role','public.reconciliation_runs','UPDATE')
     or has_table_privilege('service_role','public.reconciliation_items','INSERT')
     or has_table_privilege('service_role','public.reconciliation_items','UPDATE') then
    raise exception 'reconciliation_contract_post_guard: broad DML must remain disabled';
  end if;

  if not has_function_privilege('service_role',
    'public.server_create_reconciliation_run_v1(uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz)','EXECUTE')
    or not has_function_privilege('service_role',
    'public.server_insert_reconciliation_item_v1(uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role',
    'public.server_finish_reconciliation_run_v1(uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,text,timestamptz)','EXECUTE') then
    raise exception 'reconciliation_contract_post_guard: service_role RPC access missing';
  end if;
end
$post_guard$;
