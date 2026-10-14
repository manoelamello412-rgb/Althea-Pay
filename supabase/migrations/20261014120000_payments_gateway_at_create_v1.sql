-- gateway_runtime_invariants_guard (2026-09-09) rejects gateway_transactions without gateway_id,
-- but create_gateway_transaction had no way to set it, so /api/payments/create always failed with
-- gateway_id_required. The route now resolves the funnel's primary gateway first and passes it here.
drop function if exists public.create_gateway_transaction(uuid,uuid,text,text,numeric,text,jsonb,jsonb,text);

CREATE OR REPLACE FUNCTION public.create_gateway_transaction(p_user_id uuid, p_organization_id uuid, p_funnel_id text, p_product_id text, p_amount numeric, p_currency text, p_customer jsonb, p_metadata jsonb, p_idempotency_key text, p_gateway_id text DEFAULT NULL::text)
 RETURNS gateway_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.gateway_transactions;
  v_existing public.gateway_transactions;
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_customer jsonb := coalesce(p_customer, '{}'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_user_id is null or p_organization_id is null then raise exception 'invalid_owner'; end if;
  if not exists (select 1 from public.organization_members m where m.user_id=p_user_id and m.organization_id=p_organization_id) then
    raise exception 'owner_not_in_organization';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'invalid_amount'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if v_key is null or length(v_key) > 255 then raise exception 'invalid_idempotency_key'; end if;
  if jsonb_typeof(v_customer) <> 'object' or jsonb_typeof(v_metadata) <> 'object' then raise exception 'invalid_payload'; end if;

  if p_funnel_id is not null and not exists (
    select 1 from public.funnels f where f.id=p_funnel_id and f.organization_id=p_organization_id and f.user_id=p_user_id
  ) then raise exception 'funnel_not_found'; end if;

  if p_product_id is not null and not exists (
    select 1 from public.products p where p.id=p_product_id and p.organization_id=p_organization_id and p.status='active' and p.deleted_at is null
  ) then raise exception 'product_not_found_or_inactive'; end if;

  if p_gateway_id is not null and not exists (
    select 1 from public.gateways g where g.id=p_gateway_id and g.organization_id=p_organization_id
  ) then raise exception 'gateway_not_found'; end if;

  select * into v_existing
  from public.gateway_transactions
  where organization_id=p_organization_id and idempotency_key=v_key
  order by created_at desc limit 1;
  if found then return v_existing; end if;

  insert into public.gateway_transactions(
    user_id, organization_id, funnel_id, product_id, gateway_id, amount, currency, status,
    customer, metadata, idempotency_key, attempt_count, routing_metadata, version
  ) values (
    p_user_id, p_organization_id, p_funnel_id, p_product_id, p_gateway_id, p_amount, v_currency, 'created',
    v_customer, v_metadata, v_key, 0, '{}'::jsonb, 1
  ) returning * into v_row;

  return v_row;
exception when unique_violation then
  select * into v_existing from public.gateway_transactions
  where organization_id=p_organization_id and idempotency_key=v_key
  order by created_at desc limit 1;
  if found then return v_existing; end if;
  raise;
end;
$function$;

revoke all on function public.create_gateway_transaction(uuid,uuid,text,text,numeric,text,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.create_gateway_transaction(uuid,uuid,text,text,numeric,text,jsonb,jsonb,text,text) to service_role;
