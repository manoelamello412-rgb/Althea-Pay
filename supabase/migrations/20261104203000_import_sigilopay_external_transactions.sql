-- SigiloPay webhook-only transaction materialization.
-- Imports provider-created transactions into the tenant's operational mirror
-- before the existing webhook processor applies the provider status.
-- No outbound provider calls and no payment collection are introduced.

begin;

create or replace function public.server_process_claimed_gateway_webhook_v1(
  p_webhook_id uuid,
  p_expected_attempt integer,
  p_next_status text,
  p_external_transaction_id text,
  p_failure_code text default null,
  p_event_kind text default 'payment',
  p_amount numeric default null,
  p_currency text default null,
  p_external_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.gateway_webhook_events%rowtype;
  v_gateway public.gateways%rowtype;
  v_tx public.gateway_transactions%rowtype;
  v_attempt public.gateway_payment_attempts%rowtype;
  v_tx_count integer;
  v_attempt_count integer;
  v_result jsonb;
  v_external text := nullif(trim(coalesce(p_external_transaction_id,'')),'');
  v_payload jsonb;
  v_transaction jsonb;
  v_client jsonb;
  v_track jsonb;
  v_items jsonb;
  v_subscription jsonb;
  v_customer jsonb;
  v_metadata jsonb;
  v_currency text;
  v_amount numeric;
  v_seed_status text;
  v_idempotency_key text;
  v_created_at timestamptz;
  v_payed_at timestamptz;
  v_method text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_webhook_id is null or p_expected_attempt is null or p_expected_attempt < 1 then
    raise exception 'gateway_webhook_claim_identity_required' using errcode='22023';
  end if;

  if v_external is null then
    raise exception 'webhook_identity_required' using errcode='22023';
  end if;

  select e.* into v_event
  from public.gateway_webhook_events e
  where e.id=p_webhook_id
    and e.status='processing'
    and e.attempts=p_expected_attempt
  for update;

  if not found then
    raise exception 'gateway_webhook_fencing_lost' using errcode='40001';
  end if;

  if v_event.gateway_id is null
     or v_event.user_id is null
     or v_event.organization_id is null then
    raise exception 'tenant_context_missing' using errcode='22023';
  end if;

  select g.* into v_gateway
  from public.gateways g
  where g.id=v_event.gateway_id
    and g.user_id=v_event.user_id
    and g.organization_id=v_event.organization_id
  for update;

  if not found then
    raise exception 'gateway_tenant_mismatch' using errcode='42501';
  end if;

  -- Only SigiloPay receives independent-transaction materialization.
  -- All other providers retain the original existing-transaction contract.
  if lower(trim(coalesce(v_event.provider,''))) = 'sigilopay' then
    v_payload := coalesce(v_event.payload,'{}'::jsonb);
    v_transaction := coalesce(v_payload->'transaction','{}'::jsonb);
    v_client := coalesce(v_payload->'client','{}'::jsonb);
    v_track := coalesce(v_payload->'trackProps',v_transaction->'trackProps','{}'::jsonb);
    v_items := coalesce(v_payload->'orderItems',v_transaction->'orderItems','[]'::jsonb);
    v_subscription := coalesce(v_payload->'subscription',v_transaction->'subscription','null'::jsonb);

    if jsonb_typeof(v_transaction) <> 'object'
       or nullif(trim(coalesce(v_transaction->>'id',v_payload->>'external_transaction_id')),'') is distinct from v_external then
      raise exception 'sigilopay_transaction_identity_mismatch' using errcode='22023';
    end if;

    v_amount := coalesce(p_amount,nullif(v_transaction->>'amount','')::numeric);
    v_currency := upper(coalesce(nullif(trim(coalesce(p_currency,'')),''),nullif(trim(coalesce(v_transaction->>'currency','')),''),'BRL'));
    if v_amount is null or v_amount <= 0 or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'sigilopay_transaction_amount_or_currency_invalid' using errcode='22023';
    end if;

    v_method := upper(nullif(trim(coalesce(v_transaction->>'paymentMethod','')),''));
    if v_method not in ('CREDIT_CARD','PIX','BOLETO','CRYPTO') then
      raise exception 'sigilopay_payment_method_invalid' using errcode='22023';
    end if;

    begin
      v_created_at := coalesce(nullif(v_transaction->>'createdAt','')::timestamptz, v_event.received_at, now());
      v_payed_at := nullif(v_transaction->>'payedAt','')::timestamptz;
    exception when others then
      raise exception 'sigilopay_transaction_timestamp_invalid' using errcode='22023';
    end;

    v_customer := jsonb_strip_nulls(jsonb_build_object(
      'provider_client_id',v_client->>'id',
      'name',nullif(trim(coalesce(v_client->>'name','')),''),
      'email',nullif(lower(trim(coalesce(v_client->>'email',''))),''),
      'phone',nullif(trim(coalesce(v_client->>'phone','')),''),
      'cpf',nullif(trim(coalesce(v_client->>'cpf','')),''),
      'cnpj',nullif(trim(coalesce(v_client->>'cnpj','')),''),
      'address',case when jsonb_typeof(v_client->'address')='object' then v_client->'address' else null end
    ));

    v_metadata := jsonb_build_object(
      'source','external_gateway_mirror',
      'provider','sigilopay',
      'provider_transaction_identifier',v_transaction->>'identifier',
      'provider_offer_code',v_payload->>'offerCode',
      'checkout_url',v_payload->>'checkoutUrl',
      'payment_method',v_method,
      'original_amount',v_transaction->'originalAmount',
      'original_currency',v_transaction->>'originalCurrency',
      'exchange_rate',v_transaction->'exchangeRate',
      'commission_amount',v_transaction->'commissionAmount',
      'installments',v_transaction->'installments',
      'pix_information',v_transaction->'pixInformation',
      'pix_metadata',v_transaction->'pixMetadata',
      'boleto_information',v_transaction->'boletoInformation',
      'subscription',v_subscription,
      'order_items',v_items,
      'track_props',v_track,
      'provider_created_at',v_created_at,
      'provider_paid_at',v_payed_at,
      'provider_event_id',coalesce(p_external_event_id,v_event.provider_event_id)
    );

    -- The token is never copied into the imported transaction metadata.
    v_metadata := v_metadata - 'token';
    v_idempotency_key := 'sigilopay:' || v_gateway.id || ':' || v_external;

    select count(*) into v_tx_count
    from public.gateway_transactions t
    where t.gateway_id=v_gateway.id
      and t.user_id=v_gateway.user_id
      and t.external_id=v_external;

    if v_tx_count > 1 then
      raise exception 'transaction_tenant_mismatch' using errcode='42501';
    end if;

    if v_tx_count = 0 then
      -- Refund and chargeback events need a valid approved base transaction.
      -- Other statuses start at created and are transitioned by v11 below.
      v_seed_status := case
        when lower(trim(coalesce(p_event_kind,'payment'))) in ('refund','chargeback') then 'approved'
        else 'created'
      end;

      insert into public.gateway_transactions(
        user_id,organization_id,gateway_id,external_id,idempotency_key,
        amount,currency,status,customer,metadata,created_at,completed_at
      )
      values(
        v_gateway.user_id,v_gateway.organization_id,v_gateway.id,v_external,v_idempotency_key,
        v_amount,v_currency,v_seed_status,v_customer,v_metadata,v_created_at,
        case when v_seed_status='approved' then coalesce(v_payed_at,v_created_at) else null end
      )
      returning * into v_tx;

      perform public.allocate_and_insert_gateway_payment_attempt(
        v_gateway.user_id,
        v_tx.id,
        v_gateway.id,
        'SigiloPay',
        v_idempotency_key,
        case when v_seed_status='approved' then 'approved' else 'pending' end,
        null,
        v_external,
        null,
        null,
        null,
        'external_gateway_webhook_mirror',
        v_transaction->>'identifier',
        null,
        null,
        null
      );

      update public.gateway_webhook_events
         set transaction_id=v_tx.id
       where id=v_event.id;
    else
      select t.* into v_tx
      from public.gateway_transactions t
      where t.gateway_id=v_gateway.id
        and t.user_id=v_gateway.user_id
        and t.organization_id=v_gateway.organization_id
        and t.external_id=v_external
      for update;

      if not found then
        raise exception 'transaction_tenant_mismatch' using errcode='42501';
      end if;

      select count(*) into v_attempt_count
      from public.gateway_payment_attempts a
      where a.user_id=v_gateway.user_id
        and a.transaction_id=v_tx.id
        and a.gateway_id=v_gateway.id
        and a.external_transaction_id=v_external;

      if v_attempt_count > 1 then
        raise exception 'ambiguous_attempt';
      elsif v_attempt_count = 0 then
        perform public.allocate_and_insert_gateway_payment_attempt(
          v_gateway.user_id,
          v_tx.id,
          v_gateway.id,
          'SigiloPay',
          v_idempotency_key,
          case when v_tx.status in ('approved','refunded','chargeback') then 'approved' else 'pending' end,
          null,
          v_external,
          null,
          null,
          null,
          'external_gateway_webhook_mirror',
          v_transaction->>'identifier',
          null,
          null,
          null
        );
      end if;

      update public.gateway_webhook_events
         set transaction_id=v_tx.id
       where id=v_event.id
         and transaction_id is null;
    end if;
  else
    select count(*) into v_tx_count
    from public.gateway_transactions t
    where t.gateway_id=v_event.gateway_id
      and t.user_id=v_event.user_id
      and t.external_id=v_external;

    if v_tx_count <> 1 then
      raise exception 'transaction_tenant_mismatch' using errcode='42501';
    end if;

    select t.* into v_tx
    from public.gateway_transactions t
    where t.gateway_id=v_event.gateway_id
      and t.user_id=v_event.user_id
      and t.organization_id=v_event.organization_id
      and t.external_id=v_external
    for update;

    if not found then
      raise exception 'transaction_tenant_mismatch' using errcode='42501';
    end if;

    if v_event.transaction_id is not null
       and v_event.transaction_id <> v_tx.id then
      raise exception 'transaction_tenant_mismatch' using errcode='42501';
    end if;
  end if;

  select public.process_gateway_webhook_v11(
    p_webhook_id,
    p_next_status,
    v_external,
    p_failure_code,
    p_event_kind,
    p_amount,
    p_currency,
    p_external_event_id
  ) into v_result;

  return v_result;
end
$function$;

alter function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) owner to postgres;
revoke all on function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) to service_role;

do $sigilopay_materialization_guard$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)'::regprocedure
  ) into v_definition;

  if position('allocate_and_insert_gateway_payment_attempt' in v_definition)=0
     or position('external_gateway_mirror' in v_definition)=0
     or position('v_event.provider' in v_definition)=0 then
    raise exception 'sigilopay_materialization_guard_failed';
  end if;

  if has_function_privilege(
       'anon',
       'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)',
       'EXECUTE'
     ) then
    raise exception 'sigilopay_materialization_acl_guard_failed';
  end if;
end
$sigilopay_materialization_guard$;

commit;
