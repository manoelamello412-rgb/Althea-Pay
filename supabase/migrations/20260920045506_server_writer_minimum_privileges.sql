-- Release prerequisites for organization-aware writers.
-- Versioned only. Do not apply until separately authorized.

do $guard$
begin
  if to_regclass('public.integration_events') is null or to_regclass('public.sales') is null then
    raise exception 'writer_privilege_guard: required tables are missing';
  end if;

  if to_regprocedure('public.project_funnel_event(uuid)') is null
     or to_regprocedure('public.project_checkout_purchase(uuid)') is null then
    raise exception 'writer_privilege_guard: legacy projector functions are missing';
  end if;

  if not has_function_privilege('service_role','public.project_funnel_event(uuid)','EXECUTE') then
    raise exception 'writer_privilege_guard: project_funnel_event service_role execute state drifted';
  end if;

  if not has_function_privilege('service_role','public.project_checkout_purchase(uuid)','EXECUTE') then
    raise exception 'writer_privilege_guard: project_checkout_purchase service_role execute state drifted';
  end if;

  if has_table_privilege('service_role','public.integration_events','INSERT') then
    raise exception 'writer_privilege_guard: unexpected broad integration_events INSERT privilege';
  end if;

  if has_table_privilege('service_role','public.sales','INSERT')
     or has_table_privilege('service_role','public.sales','UPDATE') then
    raise exception 'writer_privilege_guard: unexpected broad sales write privilege';
  end if;
end
$guard$;

-- Narrow INSERT surface used by canonical server-side integration-event writers.
grant insert (
  user_id,
  organization_id,
  funnel_id,
  integration_id,
  event_type,
  original_event_type,
  protocol_version,
  session_id,
  visitor_id,
  customer_id,
  external_id,
  event_key,
  status,
  payload,
  occurred_at,
  claim_attempt
) on public.integration_events to service_role;

-- Narrow INSERT surface used by canonical server-side sale writers.
grant insert (
  id,
  user_id,
  organization_id,
  funnel_id,
  product_id,
  checkout_id,
  transaction_id,
  amount,
  currency,
  status,
  attribution,
  source,
  medium,
  campaign,
  content,
  term,
  click_id,
  external_id,
  gateway_id,
  occurred_at,
  data
) on public.sales to service_role;

-- Existing writers update only persisted sale business fields; primary key and created_at stay immutable.
grant update (
  user_id,
  organization_id,
  funnel_id,
  product_id,
  checkout_id,
  transaction_id,
  amount,
  currency,
  status,
  attribution,
  source,
  medium,
  campaign,
  content,
  term,
  click_id,
  external_id,
  gateway_id,
  occurred_at,
  data
) on public.sales to service_role;

-- Dormant legacy projectors are retained for forensic/schema compatibility but cannot be invoked by runtime service_role.
revoke execute on function public.project_funnel_event(uuid) from service_role;
revoke execute on function public.project_checkout_purchase(uuid) from service_role;

do $post_guard$
declare
  v_col text;
begin
  foreach v_col in array array[
    'user_id','organization_id','funnel_id','integration_id','event_type',
    'original_event_type','protocol_version','session_id','visitor_id','customer_id',
    'external_id','event_key','status','payload','occurred_at','claim_attempt'
  ] loop
    if not has_column_privilege('service_role','public.integration_events',v_col,'INSERT') then
      raise exception 'writer_privilege_post_guard: missing integration_events INSERT privilege on %', v_col;
    end if;
  end loop;

  foreach v_col in array array[
    'id','user_id','organization_id','funnel_id','product_id','checkout_id','transaction_id',
    'amount','currency','status','attribution','source','medium','campaign','content','term',
    'click_id','external_id','gateway_id','occurred_at','data'
  ] loop
    if not has_column_privilege('service_role','public.sales',v_col,'INSERT') then
      raise exception 'writer_privilege_post_guard: missing sales INSERT privilege on %', v_col;
    end if;
  end loop;

  foreach v_col in array array[
    'user_id','organization_id','funnel_id','product_id','checkout_id','transaction_id',
    'amount','currency','status','attribution','source','medium','campaign','content','term',
    'click_id','external_id','gateway_id','occurred_at','data'
  ] loop
    if not has_column_privilege('service_role','public.sales',v_col,'UPDATE') then
      raise exception 'writer_privilege_post_guard: missing sales UPDATE privilege on %', v_col;
    end if;
  end loop;

  if has_column_privilege('service_role','public.sales','id','UPDATE')
     or has_column_privilege('service_role','public.sales','created_at','UPDATE') then
    raise exception 'writer_privilege_post_guard: immutable sales columns unexpectedly writable';
  end if;

  if has_table_privilege('service_role','public.integration_events','INSERT')
     or has_table_privilege('service_role','public.sales','INSERT')
     or has_table_privilege('service_role','public.sales','UPDATE') then
    raise exception 'writer_privilege_post_guard: broad table-level DML privilege detected';
  end if;

  if has_function_privilege('service_role','public.project_funnel_event(uuid)','EXECUTE')
     or has_function_privilege('service_role','public.project_checkout_purchase(uuid)','EXECUTE') then
    raise exception 'writer_privilege_post_guard: legacy projector still executable by service_role';
  end if;
end
$post_guard$;
