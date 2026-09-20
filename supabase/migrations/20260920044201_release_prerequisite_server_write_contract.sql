-- Release prerequisite: narrow server-side write contract for canonical operational writers.
-- Code-only until explicitly approved for production application.

do $guard$
begin
  if to_regclass('public.sales') is null
     or to_regclass('public.integration_events') is null
     or to_regclass('public.gateway_transactions') is null
     or to_regclass('public.funnels') is null then
    raise exception 'server_write_contract_guard: required operational tables are missing';
  end if;

  if has_table_privilege('service_role','public.sales','INSERT')
     or has_table_privilege('service_role','public.sales','UPDATE')
     or has_table_privilege('service_role','public.integration_events','INSERT') then
    raise exception 'server_write_contract_guard: unexpected broad service_role DML grant already exists';
  end if;

  if to_regprocedure('public.project_funnel_event(uuid)') is null
     or to_regprocedure('public.project_checkout_purchase(uuid)') is null then
    raise exception 'server_write_contract_guard: legacy projector contract is missing';
  end if;
end
$guard$;

create or replace function public.server_insert_integration_event_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_funnel_id text,
  p_event_type text,
  p_event_key text,
  p_external_id text default null,
  p_status text default 'pending',
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now(),
  p_integration_id uuid default null,
  p_original_event_type text default null,
  p_protocol_version text default '1',
  p_session_id text default null,
  p_visitor_id text default null,
  p_customer_id text default null,
  p_claim_attempt integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null or nullif(btrim(p_funnel_id),'') is null then
    raise exception 'tenant_context_required' using errcode='22023';
  end if;

  if nullif(btrim(p_event_type),'') is null then
    raise exception 'event_type_required' using errcode='22023';
  end if;

  if p_external_id is not null and nullif(btrim(p_event_key),'') is null then
    raise exception 'external_event_requires_event_key' using errcode='22023';
  end if;

  if not exists (
    select 1
      from public.funnels f
     where f.id=p_funnel_id
       and f.user_id=p_user_id
       and f.organization_id=p_organization_id
       and f.deleted_at is null
  ) then
    raise exception 'funnel_tenant_mismatch' using errcode='42501';
  end if;

  if p_integration_id is not null and not exists (
    select 1
      from public.webhook_integrations wi
     where wi.id=p_integration_id
       and wi.user_id=p_user_id
       and wi.organization_id=p_organization_id
       and wi.funnel_id=p_funnel_id
  ) then
    raise exception 'integration_tenant_mismatch' using errcode='42501';
  end if;

  insert into public.integration_events(
    user_id,organization_id,funnel_id,integration_id,event_type,original_event_type,
    protocol_version,session_id,visitor_id,customer_id,external_id,event_key,status,
    payload,occurred_at,claim_attempt
  )
  values(
    p_user_id,p_organization_id,p_funnel_id,p_integration_id,btrim(p_event_type),p_original_event_type,
    coalesce(nullif(btrim(p_protocol_version),''),'1'),p_session_id,p_visitor_id,p_customer_id,
    p_external_id,nullif(btrim(p_event_key),''),coalesce(nullif(btrim(p_status),''),'pending'),
    coalesce(p_payload,'{}'::jsonb),coalesce(p_occurred_at,now()),greatest(coalesce(p_claim_attempt,0),0)
  )
  returning id into v_id;

  return v_id;
end
$function$;

revoke all on function public.server_insert_integration_event_v1(
  uuid,uuid,text,text,text,text,text,jsonb,timestamptz,uuid,text,text,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.server_insert_integration_event_v1(
  uuid,uuid,text,text,text,text,text,jsonb,timestamptz,uuid,text,text,text,text,text,integer
) to service_role;

create or replace function public.server_upsert_transaction_sale_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_transaction_id uuid,
  p_funnel_id text default null,
  p_product_id text default null,
  p_checkout_id uuid default null,
  p_amount numeric default null,
  p_currency text default null,
  p_attribution jsonb default '{}'::jsonb,
  p_external_id text default null,
  p_occurred_at timestamptz default now(),
  p_data jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tx public.gateway_transactions%rowtype;
  v_existing_org uuid;
  v_sale_id text;
  v_attribution jsonb := coalesce(p_attribution,'{}'::jsonb);
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null or p_transaction_id is null then
    raise exception 'transaction_tenant_context_required' using errcode='22023';
  end if;

  select * into v_tx
    from public.gateway_transactions
   where id=p_transaction_id
     and user_id=p_user_id
     and organization_id=p_organization_id;

  if not found then
    raise exception 'transaction_tenant_mismatch' using errcode='42501';
  end if;

  if p_funnel_id is not null and v_tx.funnel_id is distinct from p_funnel_id then
    raise exception 'sale_funnel_transaction_mismatch' using errcode='42501';
  end if;

  if p_checkout_id is not null and not exists (
    select 1
      from public.checkout_sessions c
     where c.id=p_checkout_id
       and c.user_id=p_user_id
       and c.organization_id=p_organization_id
       and (v_tx.funnel_id is null or c.funnel_id=v_tx.funnel_id)
  ) then
    raise exception 'sale_checkout_tenant_mismatch' using errcode='42501';
  end if;

  select s.organization_id into v_existing_org
    from public.sales s
   where s.user_id=p_user_id
     and s.transaction_id=p_transaction_id
   limit 1;

  if v_existing_org is not null and v_existing_org <> p_organization_id then
    raise exception 'sale_transaction_tenant_mismatch' using errcode='42501';
  end if;

  v_sale_id := 'gateway_tx_' || p_transaction_id::text;

  insert into public.sales(
    id,user_id,organization_id,funnel_id,product_id,checkout_id,transaction_id,
    amount,currency,status,attribution,source,medium,campaign,content,term,click_id,
    external_id,gateway_id,occurred_at,data
  )
  values(
    v_sale_id,p_user_id,p_organization_id,coalesce(p_funnel_id,v_tx.funnel_id),
    coalesce(p_product_id,v_tx.product_id),p_checkout_id,p_transaction_id,
    coalesce(p_amount,v_tx.amount),upper(coalesce(nullif(p_currency,''),v_tx.currency,'BRL')),
    'approved',v_attribution,
    nullif(v_attribution->>'source',''),nullif(v_attribution->>'medium',''),
    nullif(v_attribution->>'campaign',''),nullif(v_attribution->>'content',''),
    nullif(v_attribution->>'term',''),nullif(v_attribution->>'click_id',''),
    coalesce(p_external_id,v_tx.external_id),v_tx.gateway_id,coalesce(p_occurred_at,v_tx.completed_at,now()),
    coalesce(p_data,'{}'::jsonb)
  )
  on conflict (user_id,transaction_id) where transaction_id is not null do update set
    organization_id=excluded.organization_id,
    funnel_id=excluded.funnel_id,
    product_id=coalesce(excluded.product_id,public.sales.product_id),
    checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),
    amount=excluded.amount,
    currency=excluded.currency,
    status='approved',
    attribution=case when excluded.attribution <> '{}'::jsonb then excluded.attribution else public.sales.attribution end,
    source=coalesce(excluded.source,public.sales.source),
    medium=coalesce(excluded.medium,public.sales.medium),
    campaign=coalesce(excluded.campaign,public.sales.campaign),
    content=coalesce(excluded.content,public.sales.content),
    term=coalesce(excluded.term,public.sales.term),
    click_id=coalesce(excluded.click_id,public.sales.click_id),
    external_id=coalesce(excluded.external_id,public.sales.external_id),
    gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id),
    occurred_at=coalesce(excluded.occurred_at,public.sales.occurred_at),
    data=coalesce(public.sales.data,'{}'::jsonb)||excluded.data
  returning id into v_sale_id;

  return v_sale_id;
end
$function$;

revoke all on function public.server_upsert_transaction_sale_v1(
  uuid,uuid,uuid,text,text,uuid,numeric,text,jsonb,text,timestamptz,jsonb
) from public, anon, authenticated;
grant execute on function public.server_upsert_transaction_sale_v1(
  uuid,uuid,uuid,text,text,uuid,numeric,text,jsonb,text,timestamptz,jsonb
) to service_role;

create or replace function public.server_update_sale_status_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_status text,
  p_sale_id text default null,
  p_transaction_id uuid default null,
  p_external_id text default null,
  p_data jsonb default null,
  p_occurred_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_target public.sales%rowtype;
  v_candidate public.sales%rowtype;
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_user_id is null or p_organization_id is null or nullif(btrim(p_status),'') is null then
    raise exception 'sale_update_context_required' using errcode='22023';
  end if;

  if p_sale_id is null and p_transaction_id is null and p_external_id is null then
    raise exception 'sale_identifier_required' using errcode='22023';
  end if;

  if p_sale_id is not null then
    select * into v_target
      from public.sales
     where id=p_sale_id
       and user_id=p_user_id
       and organization_id=p_organization_id;
  end if;

  if v_target.id is null and p_transaction_id is not null then
    if not exists (
      select 1 from public.gateway_transactions t
       where t.id=p_transaction_id
         and t.user_id=p_user_id
         and t.organization_id=p_organization_id
    ) then
      raise exception 'transaction_tenant_mismatch' using errcode='42501';
    end if;

    select * into v_target
      from public.sales
     where transaction_id=p_transaction_id
       and user_id=p_user_id
       and organization_id=p_organization_id;
  end if;

  if v_target.id is null and p_external_id is not null then
    select count(*) into v_count
      from public.sales
     where external_id=p_external_id
       and user_id=p_user_id
       and organization_id=p_organization_id;

    if v_count > 1 then
      raise exception 'sale_external_id_ambiguous' using errcode='21000';
    end if;

    if v_count = 1 then
      select * into v_candidate
        from public.sales
       where external_id=p_external_id
         and user_id=p_user_id
         and organization_id=p_organization_id
       limit 1;

      if p_transaction_id is not null
         and v_candidate.transaction_id is not null
         and v_candidate.transaction_id <> p_transaction_id then
        raise exception 'sale_external_id_conflict' using errcode='42501';
      end if;

      v_target := v_candidate;
    end if;
  end if;

  if v_target.id is null then
    return null;
  end if;

  update public.sales
     set status=btrim(p_status),
         data=case when p_data is null then data else p_data end,
         occurred_at=coalesce(p_occurred_at,occurred_at)
   where id=v_target.id
     and user_id=p_user_id
     and organization_id=p_organization_id;

  return v_target.id;
end
$function$;

revoke all on function public.server_update_sale_status_v1(
  uuid,uuid,text,text,uuid,text,jsonb,timestamptz
) from public, anon, authenticated;
grant execute on function public.server_update_sale_status_v1(
  uuid,uuid,text,text,uuid,text,jsonb,timestamptz
) to service_role;

-- These projectors have no runtime caller in the canonical repository and retain legacy
-- external-global identity behavior. Keep the functions for forensic/backward compatibility,
-- but remove the server runtime execution surface until they are explicitly modernized.
revoke execute on function public.project_funnel_event(uuid) from service_role;
revoke execute on function public.project_checkout_purchase(uuid) from service_role;

do $post_guard$
begin
  if has_table_privilege('service_role','public.sales','INSERT')
     or has_table_privilege('service_role','public.sales','UPDATE')
     or has_table_privilege('service_role','public.integration_events','INSERT') then
    raise exception 'server_write_contract_post_guard: broad service_role table DML must remain disabled';
  end if;

  if not has_function_privilege('service_role',
       'public.server_insert_integration_event_v1(uuid,uuid,text,text,text,text,text,jsonb,timestamptz,uuid,text,text,text,text,text,integer)',
       'EXECUTE') then
    raise exception 'server_write_contract_post_guard: integration-event writer RPC not executable by service_role';
  end if;

  if not has_function_privilege('service_role',
       'public.server_upsert_transaction_sale_v1(uuid,uuid,uuid,text,text,uuid,numeric,text,jsonb,text,timestamptz,jsonb)',
       'EXECUTE') then
    raise exception 'server_write_contract_post_guard: sale upsert RPC not executable by service_role';
  end if;

  if not has_function_privilege('service_role',
       'public.server_update_sale_status_v1(uuid,uuid,text,text,uuid,text,jsonb,timestamptz)',
       'EXECUTE') then
    raise exception 'server_write_contract_post_guard: sale update RPC not executable by service_role';
  end if;

  if has_function_privilege('service_role','public.project_funnel_event(uuid)','EXECUTE')
     or has_function_privilege('service_role','public.project_checkout_purchase(uuid)','EXECUTE') then
    raise exception 'server_write_contract_post_guard: legacy projectors remain executable by service_role';
  end if;
end
$post_guard$;
