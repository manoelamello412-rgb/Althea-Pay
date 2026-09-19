create or replace function public.prepare_gateway_payment_link(
  p_user_id uuid,
  p_funnel_id text,
  p_amount numeric,
  p_currency text,
  p_link_type text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_gateway text;
  v_provider text;
  v_caps jsonb;
  v_tx uuid;
  v_link uuid;
  v_existing public.gateway_payment_links%rowtype;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden';
  end if;

  if p_amount <= 0 or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_amount_currency';
  end if;
  if p_link_type not in ('pix','card','payment_link') then
    raise exception 'invalid_link_type';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception 'missing_idempotency_key';
  end if;

  select * into v_existing
  from public.gateway_payment_links
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'link_id', v_existing.id,
      'transaction_id', v_existing.transaction_id,
      'gateway_id', v_existing.gateway_id,
      'provider', v_existing.provider,
      'link_type', v_existing.link_type,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'payment_url', v_existing.payment_url,
      'pix_copy_paste', v_existing.pix_copy_paste,
      'qr_code_base64', v_existing.qr_code_base64,
      'expires_at', v_existing.expires_at,
      'idempotent_replay', true
    );
  end if;

  select g.id, g.provider, g.capabilities
    into v_gateway, v_provider, v_caps
  from public.gateways g
  where g.user_id = p_user_id
    and g.status in ('connected','degraded')
    and g.environment = 'production'
    and coalesce((g.capabilities->'payment_link_types') ? p_link_type, false)
  order by g.id
  limit 1;

  if v_gateway is null then
    raise exception 'no_gateway_payment_link_capability';
  end if;

  insert into public.gateway_transactions(
    user_id,funnel_id,gateway_id,idempotency_key,amount,currency,status,metadata,routing_metadata
  ) values (
    p_user_id,p_funnel_id,v_gateway,p_idempotency_key,p_amount,p_currency,'created',
    jsonb_build_object('operation','manual_payment_link','link_type',p_link_type),
    jsonb_build_object('source','gateway-payment-link')
  ) returning id into v_tx;

  insert into public.gateway_payment_links(
    user_id,funnel_id,transaction_id,gateway_id,provider,link_type,amount,currency,idempotency_key,metadata
  ) values (
    p_user_id,p_funnel_id,v_tx,v_gateway,v_provider,p_link_type,p_amount,p_currency,p_idempotency_key,
    jsonb_build_object('capabilities',v_caps)
  ) returning id into v_link;

  return jsonb_build_object(
    'link_id',v_link,
    'transaction_id',v_tx,
    'gateway_id',v_gateway,
    'provider',v_provider,
    'link_type',p_link_type,
    'amount',p_amount,
    'currency',p_currency,
    'status','created',
    'idempotent_replay',false
  );
exception
  when unique_violation then
    select * into v_existing
    from public.gateway_payment_links
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object(
        'link_id', v_existing.id,
        'transaction_id', v_existing.transaction_id,
        'gateway_id', v_existing.gateway_id,
        'provider', v_existing.provider,
        'link_type', v_existing.link_type,
        'amount', v_existing.amount,
        'currency', v_existing.currency,
        'status', v_existing.status,
        'payment_url', v_existing.payment_url,
        'pix_copy_paste', v_existing.pix_copy_paste,
        'qr_code_base64', v_existing.qr_code_base64,
        'expires_at', v_existing.expires_at,
        'idempotent_replay', true
      );
    end if;
    raise;
end;
$function$;

revoke all on function public.prepare_gateway_payment_link(uuid,text,numeric,text,text,text) from public;
grant execute on function public.prepare_gateway_payment_link(uuid,text,numeric,text,text,text) to authenticated, service_role;