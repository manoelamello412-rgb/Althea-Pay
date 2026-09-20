-- Organization-aware server-side reconciliation write contract.
-- Versioned only. Do not apply without explicit release authorization.

do $guard$
begin
  if to_regclass('public.reconciliation_runs') is null
     or to_regclass('public.reconciliation_items') is null
     or to_regclass('public.gateways') is null
     or to_regclass('public.gateway_transactions') is null then
    raise exception 'reconciliation_contract_guard: required tables are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reconciliation_runs'
      and column_name='organization_id' and data_type='uuid' and is_nullable='NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reconciliation_items'
      and column_name='organization_id' and data_type='uuid' and is_nullable='NO'
  ) then
    raise exception 'reconciliation_contract_guard: organization_id schema is unexpected';
  end if;

  if has_table_privilege('service_role','public.reconciliation_runs','INSERT')
     or has_table_privilege('service_role','public.reconciliation_runs','UPDATE')
     or has_table_privilege('service_role','public.reconciliation_items','INSERT')
     or has_table_privilege('service_role','public.reconciliation_items','UPDATE') then
    raise exception 'reconciliation_contract_guard: unexpected direct reconciliation DML privilege';
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
declare
  v_run_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null
     or nullif(btrim(p_gateway_id),'') is null
     or p_period_start is null or p_period_end is null
     or p_period_end < p_period_start then
    raise exception 'invalid_reconciliation_run_context' using errcode='22023';
  end if;

  if not exists (
    select 1
      from public.gateways g
     where g.id=p_gateway_id
       and g.user_id=p_user_id
       and g.organization_id=p_organization_id
  ) then
    raise exception 'reconciliation_gateway_tenant_mismatch' using errcode='42501';
  end if;

  insert into public.reconciliation_runs(
    user_id,organization_id,gateway_id,period_start,period_end,status,
    source_type,source_reference,started_at
  )
  values(
    p_user_id,p_organization_id,p_gateway_id,p_period_start,p_period_end,'running',
    coalesce(nullif(btrim(p_source_type),''),'gateway_api'),
    nullif(btrim(p_source_reference),''),
    coalesce(p_started_at,now())
  )
  returning id into v_run_id;

  return v_run_id;
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
  p_status text,
  p_transaction_id uuid default null,
  p_external_transaction_id text default null,
  p_expected_amount numeric default null,
  p_reported_amount numeric default null,
  p_discrepancy_amount numeric default null,
  p_mismatch_reason text default null,
  p_gateway_payload jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_provider_event_id text default null,
  p_provider_fee numeric default null,
  p_settled_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_item_id uuid;
  v_run public.reconciliation_runs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null or p_run_id is null
     or p_status not in ('matched','amount_mismatch','missing_internal','missing_gateway','duplicate','unmatched') then
    raise exception 'invalid_reconciliation_item_context' using errcode='22023';
  end if;

  select * into v_run
    from public.reconciliation_runs
   where id=p_run_id
     and user_id=p_user_id
     and organization_id=p_organization_id;

  if not found then
    raise exception 'reconciliation_run_tenant_mismatch' using errcode='42501';
  end if;

  if v_run.status <> 'running' then
    raise exception 'reconciliation_run_not_writable:%', v_run.status using errcode='55000';
  end if;

  if p_transaction_id is not null and not exists (
    select 1
      from public.gateway_transactions t
     where t.id=p_transaction_id
       and t.user_id=p_user_id
       and t.organization_id=p_organization_id
       and (v_run.gateway_id is null or t.gateway_id=v_run.gateway_id)
  ) then
    raise exception 'reconciliation_transaction_tenant_mismatch' using errcode='42501';
  end if;

  if p_provider_fee is not null and p_provider_fee < 0 then
    raise exception 'invalid_reconciliation_provider_fee' using errcode='22023';
  end if;

  insert into public.reconciliation_items(
    user_id,organization_id,run_id,transaction_id,external_transaction_id,status,
    expected_amount,reported_amount,discrepancy_amount,mismatch_reason,
    gateway_payload,metadata,provider_event_id,provider_fee,settled_at
  )
  values(
    p_user_id,p_organization_id,p_run_id,p_transaction_id,
    nullif(btrim(p_external_transaction_id),''),
    p_status,p_expected_amount,p_reported_amount,p_discrepancy_amount,
    nullif(btrim(p_mismatch_reason),''),
    coalesce(p_gateway_payload,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb),
    nullif(btrim(p_provider_event_id),''),
    p_provider_fee,p_settled_at
  )
  returning id into v_item_id;

  return v_item_id;
end
$function$;

revoke all on function public.server_insert_reconciliation_item_v1(
  uuid,uuid,uuid,text,uuid,text,numeric,numeric,numeric,text,jsonb,jsonb,text,numeric,timestamptz
) from public, anon, authenticated;
grant execute on function public.server_insert_reconciliation_item_v1(
  uuid,uuid,uuid,text,uuid,text,numeric,numeric,numeric,text,jsonb,jsonb,text,numeric,timestamptz
) to service_role;

create or replace function public.server_finalize_reconciliation_run_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_matched_count integer default 0,
  p_mismatch_count integer default 0,
  p_gross_expected numeric default 0,
  p_gross_reported numeric default 0,
  p_fees_expected numeric default 0,
  p_fees_reported numeric default 0,
  p_discrepancy_amount numeric default null,
  p_error_message text default null,
  p_completed_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_current_status text;
  v_net_expected numeric;
  v_net_reported numeric;
  v_discrepancy numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null or p_run_id is null
     or p_status not in ('completed','failed') then
    raise exception 'invalid_reconciliation_finalize_context' using errcode='22023';
  end if;

  if p_matched_count < 0 or p_mismatch_count < 0
     or p_gross_expected < 0 or p_gross_reported < 0
     or p_fees_expected < 0 or p_fees_reported < 0 then
    raise exception 'invalid_reconciliation_totals' using errcode='22023';
  end if;

  select status into v_current_status
    from public.reconciliation_runs
   where id=p_run_id
     and user_id=p_user_id
     and organization_id=p_organization_id
   for update;

  if not found then
    raise exception 'reconciliation_run_tenant_mismatch' using errcode='42501';
  end if;

  if v_current_status=p_status then
    return true;
  end if;

  if v_current_status not in ('pending','running') then
    raise exception 'reconciliation_invalid_run_transition:%->%', v_current_status, p_status
      using errcode='55000';
  end if;

  v_net_expected:=p_gross_expected-p_fees_expected;
  v_net_reported:=p_gross_reported-p_fees_reported;
  v_discrepancy:=coalesce(p_discrepancy_amount,v_net_expected-v_net_reported);

  update public.reconciliation_runs
     set status=p_status,
         matched_count=p_matched_count,
         mismatch_count=p_mismatch_count,
         gross_expected=p_gross_expected,
         gross_reported=p_gross_reported,
         fees_expected=p_fees_expected,
         fees_reported=p_fees_reported,
         net_expected=v_net_expected,
         net_reported=v_net_reported,
         discrepancy_amount=v_discrepancy,
         error_message=case when p_status='failed' then left(p_error_message,2000) else null end,
         completed_at=coalesce(p_completed_at,now()),
         updated_at=now()
   where id=p_run_id
     and user_id=p_user_id
     and organization_id=p_organization_id;

  return true;
end
$function$;

revoke all on function public.server_finalize_reconciliation_run_v1(
  uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,numeric,numeric,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.server_finalize_reconciliation_run_v1(
  uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,numeric,numeric,text,timestamptz
) to service_role;

do $post_guard$
begin
  if has_table_privilege('service_role','public.reconciliation_runs','INSERT')
     or has_table_privilege('service_role','public.reconciliation_runs','UPDATE')
     or has_table_privilege('service_role','public.reconciliation_items','INSERT')
     or has_table_privilege('service_role','public.reconciliation_items','UPDATE') then
    raise exception 'reconciliation_contract_post_guard: direct reconciliation DML must remain disabled';
  end if;

  if not has_function_privilege('service_role',
       'public.server_create_reconciliation_run_v1(uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'public.server_insert_reconciliation_item_v1(uuid,uuid,uuid,text,uuid,text,numeric,numeric,numeric,text,jsonb,jsonb,text,numeric,timestamptz)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'public.server_finalize_reconciliation_run_v1(uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,numeric,numeric,text,timestamptz)',
       'EXECUTE') then
    raise exception 'reconciliation_contract_post_guard: service_role execute contract missing';
  end if;

  if has_function_privilege('anon',
       'public.server_create_reconciliation_run_v1(uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.server_create_reconciliation_run_v1(uuid,uuid,text,timestamptz,timestamptz,text,text,timestamptz)',
       'EXECUTE')
     or has_function_privilege('anon',
       'public.server_insert_reconciliation_item_v1(uuid,uuid,uuid,text,uuid,text,numeric,numeric,numeric,text,jsonb,jsonb,text,numeric,timestamptz)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.server_insert_reconciliation_item_v1(uuid,uuid,uuid,text,uuid,text,numeric,numeric,numeric,text,jsonb,jsonb,text,numeric,timestamptz)',
       'EXECUTE')
     or has_function_privilege('anon',
       'public.server_finalize_reconciliation_run_v1(uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,numeric,numeric,text,timestamptz)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.server_finalize_reconciliation_run_v1(uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,numeric,numeric,text,timestamptz)',
       'EXECUTE') then
    raise exception 'reconciliation_contract_post_guard: privileged RPC exposed to client role';
  end if;
end
$post_guard$;
