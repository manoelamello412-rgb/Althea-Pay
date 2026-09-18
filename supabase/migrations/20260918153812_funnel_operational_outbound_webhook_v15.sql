grant select on public.outbound_webhook_deliveries to authenticated;

do $$
declare
  v_definition text;
begin
  select regexp_replace(pg_get_viewdef('public.v_funnel_operational_timeline'::regclass, true), ';\s*$', '')
    into v_definition;

  if v_definition is null or length(v_definition)=0 then
    raise exception 'operational_timeline_definition_missing';
  end if;

  execute
    'create or replace view public.v_funnel_operational_timeline
       with (security_invoker=true)
     as ' || v_definition || $view$
     union all
     select
       'outbound_webhook:'||d.id::text as event_id,
       e.organization_id,
       d.user_id,
       e.funnel_id,
       'outbound_webhook_delivery'::text as source,
       'integration_health'::text as category,
       'outbound_webhook_'||d.event_type as event_type,
       d.status,
       case
         when d.error_message is not null
              or coalesce(d.response_code,0)>=400
              or lower(d.status) in ('failed','error','dead_letter','rejected')
           then 'error'
         when lower(d.status) in ('pending','retry','processing','queued')
           then 'warning'
         when lower(d.status) in ('delivered','success','completed','sent')
           then 'success'
         else 'info'
       end::text as severity,
       null::numeric as amount,
       null::text as currency,
       nullif(d.payload->>'checkout_id','')::text as checkout_id,
       coalesce(
         nullif(d.payload->>'transaction_id',''),
         nullif(e.payload->>'transaction_id','')
       )::text as transaction_id,
       coalesce(
         nullif(d.payload->>'gateway_id',''),
         nullif(e.payload->>'gateway_id','')
       )::text as gateway_id,
       coalesce(
         nullif(d.payload->>'external_id',''),
         e.external_id
       )::text as external_id,
       d.error_message as message,
       jsonb_build_object(
         'webhook_id',d.webhook_id,
         'source_event_id',d.event_id,
         'attempt',d.attempt,
         'response_code',d.response_code,
         'response_time_ms',d.response_time_ms,
         'next_retry_at',d.next_retry_at,
         'delivered_at',d.delivered_at,
         'idempotency_key',d.idempotency_key
       ) || coalesce(d.payload,'{}'::jsonb) as metadata,
       coalesce(d.delivered_at,d.created_at) as occurred_at
     from public.outbound_webhook_deliveries d
     join public.integration_events e
       on e.id=d.event_id
      and e.user_id=d.user_id
     where e.funnel_id is not null
     $view$;
end $$;

grant select on public.v_funnel_operational_timeline to authenticated;
revoke all on public.v_funnel_operational_timeline from anon;
