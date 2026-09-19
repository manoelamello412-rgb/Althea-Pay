
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
       'gateway_health:'||b.id::text||':'||hs.id::text as event_id,
       b.organization_id,
       g.user_id,
       b.funnel_id,
       'gateway_health'::text as source,
       'integration_health'::text as category,
       'gateway_health'::text as event_type,
       case
         when hs.circuit_state='open' then 'circuit_open'
         when hs.is_healthy=false then 'unhealthy'
         when hs.circuit_state='half_open' then 'degraded'
         else 'healthy'
       end::text as status,
       case
         when hs.is_healthy=false or hs.circuit_state='open' then 'error'
         when hs.circuit_state='half_open'
              or hs.consecutive_failures>0
              or coalesce(hs.latency_ms,0)>=1000
           then 'warning'
         else 'success'
       end::text as severity,
       null::numeric as amount,
       null::text as currency,
       null::text as checkout_id,
       null::text as transaction_id,
       g.id::text as gateway_id,
       null::text as external_id,
       case
         when hs.is_healthy=false then 'Gateway não saudável.'
         when hs.circuit_state='open' then 'Circuit breaker do gateway aberto.'
         when hs.circuit_state='half_open' then 'Gateway em recuperação (half-open).'
         when coalesce(hs.latency_ms,0)>=1000 then 'Gateway saudável com latência elevada.'
         else 'Gateway saudável.'
       end::text as message,
       jsonb_build_object(
         'gateway_name',hs.gateway_name,
         'provider',g.provider,
         'display_name',g.display_name,
         'latency_ms',hs.latency_ms,
         'consecutive_failures',hs.consecutive_failures,
         'circuit_state',hs.circuit_state,
         'is_healthy',hs.is_healthy,
         'binding_role',b.role,
         'binding_priority',b.priority,
         'is_primary',b.is_primary,
         'checked_at',hs.checked_at
       ) || coalesce(hs.details,'{}'::jsonb) as metadata,
       hs.checked_at as occurred_at
     from public.funnel_gateway_bindings b
     join public.gateways g
       on g.id=b.gateway_id
      and g.organization_id=b.organization_id
     join lateral (
       select h.*
       from public.gateway_health_snapshots h
       where h.gateway_id=g.circuit_id
         and h.user_id=g.user_id
       order by h.checked_at desc
       limit 1
     ) hs on true
     where b.status='active'
     $view$;
end $$;

grant select on public.v_funnel_operational_timeline to authenticated,service_role;
revoke all on public.v_funnel_operational_timeline from anon;
