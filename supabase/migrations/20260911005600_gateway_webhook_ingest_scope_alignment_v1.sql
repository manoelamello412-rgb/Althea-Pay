begin;

create or replace function public.ingest_gateway_webhook_v2(
  p_gateway_id text,
  p_provider text,
  p_provider_event_id text,
  p_signature_timestamp timestamptz,
  p_payload jsonb
) returns table(duplicate boolean, webhook_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_id uuid;
  v_provider text;
  v_gateway_provider text;
begin
  if coalesce(length(trim(p_gateway_id)),0)=0
     or coalesce(length(trim(p_provider)),0)=0
     or coalesce(length(trim(p_provider_event_id)),0)=0 then
    raise exception 'gateway_provider_and_event_id_required';
  end if;

  select lower(trim(provider)) into v_gateway_provider
  from public.gateways
  where id=trim(p_gateway_id)
  limit 1;
  if v_gateway_provider is null then raise exception 'gateway_not_found'; end if;

  v_provider:=lower(trim(p_provider));
  if v_gateway_provider<>v_provider then raise exception 'gateway_provider_mismatch'; end if;

  insert into public.gateway_webhook_events(
    gateway_id,provider,provider_event_id,signature_timestamp,payload,
    status,received_at,updated_at,next_attempt_at
  ) values(
    trim(p_gateway_id),v_provider,trim(p_provider_event_id),p_signature_timestamp,
    coalesce(p_payload,'{}'::jsonb),'accepted',now(),now(),now()
  ) on conflict (gateway_id,provider,provider_event_id) where gateway_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
    from public.gateway_webhook_events e
    where e.gateway_id=trim(p_gateway_id)
      and e.provider=v_provider
      and e.provider_event_id=trim(p_provider_event_id)
    limit 1;
    if v_id is not null then return query select true,v_id; end if;
    raise exception 'webhook_ingestion_conflict';
  end if;

  return query select false,v_id;
end
$function$;

revoke all on function public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb) to service_role;

commit;
