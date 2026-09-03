create or replace function public.ingest_gateway_webhook(p_provider text,p_provider_event_id text,p_signature_timestamp timestamptz,p_payload jsonb)
returns table(duplicate boolean,webhook_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_id uuid;
begin
  if coalesce(length(trim(p_provider)),0)=0 or coalesce(length(trim(p_provider_event_id)),0)=0 then raise exception 'provider_and_event_id_required'; end if;
  insert into public.gateway_webhook_events(provider,provider_event_id,signature_timestamp,payload)
  values(lower(trim(p_provider)),trim(p_provider_event_id),p_signature_timestamp,coalesce(p_payload,'{}'::jsonb))
  on conflict(provider,provider_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.gateway_webhook_events where provider=lower(trim(p_provider)) and provider_event_id=trim(p_provider_event_id);
    return query select true,v_id;
  end if;
  return query select false,v_id;
end
$function$;
revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) to service_role;
