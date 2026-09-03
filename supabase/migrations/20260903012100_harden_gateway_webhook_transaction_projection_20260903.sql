create or replace function public.ingest_gateway_webhook(p_provider text, p_provider_event_id text, p_signature_timestamp timestamp with time zone, p_payload jsonb)
returns table(duplicate boolean, webhook_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_status text;
  v_external_id text;
  v_attempt record;
  v_route record;
  v_routing record;
  v_existing uuid;
  v_transitioned public.gateway_transactions;
begin
  if coalesce(length(trim(p_provider)),0)=0 or coalesce(length(trim(p_provider_event_id)),0)=0 then raise exception 'provider_and_event_id_required'; end if;
  insert into public.gateway_webhook_events(provider,provider_event_id,signature_timestamp,payload)
  values(lower(trim(p_provider)),trim(p_provider_event_id),p_signature_timestamp,coalesce(p_payload,'{}'::jsonb))
  on conflict(provider,provider_event_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.gateway_webhook_events where provider=lower(trim(p_provider)) and provider_event_id=trim(p_provider_event_id);
    return query select true,v_id;
  end if;

  v_status := lower(trim(coalesce(p_payload->>'status',p_payload->>'payment_status',p_payload->>'state','')));
  if v_status='processing' then v_status='pending';
  elsif v_status in ('paid','success','completed','approved') then v_status='approved';
  elsif v_status in ('declined','rejected','failed','error') then v_status='failed';
  end if;

  if v_status in ('pending','approved','failed') then
    for v_external_id in select x from jsonb_array_elements_text(jsonb_build_array(nullif(p_payload->>'external_id',''),nullif(p_payload->>'transaction_id',''),nullif(p_payload->>'id',''))) as t(x) where x is not null loop
      select * into v_attempt from public.gateway_payment_attempts a where a.external_transaction_id=v_external_id and a.user_id is not null order by a.created_at desc limit 1;
      exit when v_attempt.id is not null;
    end loop;
    if v_attempt.id is not null then
      select * into v_route from public.gateway_routes r where r.id=v_attempt.routing_rule_id and r.user_id=v_attempt.user_id and r.gateway_id=v_attempt.gateway_id limit 1;
      select * into v_routing from public.transaction_routing_logs l where l.user_id=v_attempt.user_id and l.idempotency_key=split_part(v_attempt.idempotency_key,':',1) order by l.created_at desc limit 1;
      if v_route.id is not null and v_routing.id is not null then
        select gt.id into v_existing from public.gateway_transactions gt where gt.user_id=v_attempt.user_id and gt.external_id=v_attempt.external_transaction_id order by gt.created_at desc limit 1;
        if v_existing is null then
          insert into public.gateway_transactions(user_id,funnel_id,product_id,gateway_id,external_id,idempotency_key,amount,currency,status,customer,metadata,attempt_count,routing_metadata)
          values(v_attempt.user_id,v_route.funnel_id,v_attempt.product_id,v_attempt.gateway_id::text,v_attempt.external_transaction_id,split_part(v_attempt.idempotency_key,':',1),v_routing.amount,upper(v_routing.currency),'created',coalesce(case when jsonb_typeof(p_payload->'customer')='object' then p_payload->'customer' else null end,'{}'::jsonb),coalesce(p_payload,'{}'::jsonb),greatest(coalesce(v_attempt.attempt_order,1),1),jsonb_build_object('materialized_from_gateway_webhook',true,'provider',lower(trim(p_provider)),'provider_event_id',trim(p_provider_event_id),'routing_log_id',v_routing.id,'payment_attempt_id',v_attempt.id)) returning id into v_existing;
        end if;
        select * into v_transitioned from public.transition_gateway_transaction_status(v_existing,v_attempt.user_id,v_status,nullif(p_payload->>'failure_code',''),v_attempt.external_transaction_id);
      end if;
    end if;
  end if;
  return query select false,v_id;
end
$function$;
revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) to service_role;
