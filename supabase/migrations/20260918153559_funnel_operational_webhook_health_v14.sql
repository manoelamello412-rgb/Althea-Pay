grant select on public.webhook_deliveries to authenticated;

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
       'webhook_delivery:'||d.id::text as event_id,
       wi.organization_id,
       d.user_id,
       wi.funnel_id,
       'webhook_delivery'::text as source,
       'integration_health'::text as category,
       'webhook_'||d.event_type as event_type,
       d.status,
       case
         when d.signature_valid=false
              or d.error_message is not null
              or coalesce(d.response_code,0)>=400
              or lower(d.status) in ('failed','error','dead_letter','rejected')
           then 'error'
         when lower(d.status) in ('pending','retry','processing')
           then 'warning'
         when lower(d.status) in ('delivered','success','completed')
           then 'success'
         else 'info'
       end::text as severity,
       null::numeric as amount,
       null::text as currency,
       nullif(d.payload->>'checkout_id','')::text as checkout_id,
       nullif(d.payload->>'transaction_id','')::text as transaction_id,
       nullif(d.payload->>'gateway_id','')::text as gateway_id,
       nullif(d.payload->>'external_id','')::text as external_id,
       case
         when d.signature_valid=false then 'Assinatura do webhook inválida.'
         else d.error_message
       end::text as message,
       jsonb_build_object(
         'integration_id',wi.id,
         'provider',wi.provider,
         'integration_status',wi.status,
         'signature_valid',d.signature_valid,
         'attempt',d.attempt,
         'response_code',d.response_code,
         'response_time_ms',d.response_time_ms,
         'delivered_at',d.delivered_at
       ) || coalesce(d.payload,'{}'::jsonb) as metadata,
       coalesce(d.delivered_at,d.created_at) as occurred_at
     from public.webhook_deliveries d
     join public.webhook_integrations wi
       on wi.id=d.integration_id
      and wi.user_id=d.user_id
     where wi.funnel_id is not null
     $view$;
end $$;

grant select on public.v_funnel_operational_timeline to authenticated;
revoke all on public.v_funnel_operational_timeline from anon;
