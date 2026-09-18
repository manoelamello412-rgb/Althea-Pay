grant select on public.gateway_checkout_telemetry to authenticated;
grant select on public.transaction_audit_events to authenticated;

create or replace view public.v_funnel_operational_timeline
with (security_invoker=true)
as
select
  'integration:'||e.id::text as event_id,
  e.organization_id,
  e.user_id,
  e.funnel_id,
  'integration_event'::text as source,
  case
    when e.event_type like 'payment_%' or e.event_type in ('purchase','refund','chargeback') then 'payment'
    when e.event_type like 'checkout_%' then 'checkout'
    when e.event_type like 'chat_%' then 'chat'
    else 'funnel'
  end::text as category,
  e.event_type,
  e.status,
  case
    when e.error_message is not null or e.status in ('failed','error') then 'error'
    when e.status in ('retry','pending','processing') then 'warning'
    else 'info'
  end::text as severity,
  null::numeric as amount,
  null::text as currency,
  nullif(e.payload->>'checkout_id','')::text as checkout_id,
  nullif(e.payload->>'transaction_id','')::text as transaction_id,
  nullif(e.payload->>'gateway_id','')::text as gateway_id,
  e.external_id,
  e.error_message as message,
  e.payload as metadata,
  e.occurred_at
from public.integration_events e
where e.funnel_id is not null

union all

select
  'checkout_event:'||ce.id::text,
  cs.organization_id,
  cs.user_id,
  cs.funnel_id,
  'checkout_event',
  'checkout',
  ce.event_type,
  coalesce(nullif(ce.payload->>'status',''),cs.status),
  case
    when lower(ce.event_type) ~ '(fail|error|declin)' then 'error'
    when lower(ce.event_type) ~ '(abandon|pending|processing)' then 'warning'
    when lower(ce.event_type) ~ '(approv|paid|complet|success)' then 'success'
    else 'info'
  end,
  cs.amount,
  cs.currency,
  ce.checkout_id::text,
  nullif(ce.payload->>'transaction_id',''),
  nullif(ce.payload->>'gateway_id',''),
  ce.external_id,
  coalesce(nullif(ce.payload->>'error',''),nullif(ce.payload->>'message','')),
  ce.payload,
  ce.created_at
from public.checkout_events ce
join public.checkout_sessions cs on cs.id=ce.checkout_id
where cs.funnel_id is not null

union all

select
  'checkout_telemetry:'||t.id::text,
  cs.organization_id,
  t.user_id,
  coalesce(t.funnel_id,cs.funnel_id),
  'checkout_telemetry',
  'checkout',
  t.event_type,
  t.event_type,
  case
    when lower(t.event_type) ~ '(fail|error|declin)' then 'error'
    when lower(t.event_type) ~ '(abandon|pending|retry)' then 'warning'
    else 'info'
  end,
  cs.amount,
  cs.currency,
  t.checkout_id::text,
  t.transaction_id::text,
  nullif(t.payload->>'gateway_id',''),
  nullif(t.payload->>'external_id',''),
  coalesce(nullif(t.payload->>'error',''),nullif(t.payload->>'message','')),
  t.payload||jsonb_build_object('payment_method',t.payment_method,'field_name',t.field_name),
  t.occurred_at
from public.gateway_checkout_telemetry t
left join public.checkout_sessions cs on cs.id=t.checkout_id
where coalesce(t.funnel_id,cs.funnel_id) is not null

union all

select
  'gateway_transaction:'||gt.id::text,
  gt.organization_id,
  gt.user_id,
  gt.funnel_id,
  'gateway_transaction',
  'payment',
  'transaction_'||coalesce(gt.status,'unknown'),
  gt.status,
  case
    when lower(gt.status) ~ '(fail|error|declin|cancel|chargeback)' or gt.error_message is not null then 'error'
    when lower(gt.status) ~ '(pending|processing|created)' then 'warning'
    when lower(gt.status) ~ '(approv|paid|success|complet)' then 'success'
    else 'info'
  end,
  gt.amount,
  gt.currency,
  nullif(gt.metadata->>'checkout_id',''),
  gt.id::text,
  gt.gateway_id,
  gt.external_id,
  gt.error_message,
  gt.metadata||gt.routing_metadata||jsonb_build_object('attempt_count',gt.attempt_count,'failure_code',gt.failure_code,'version',gt.version),
  coalesce(gt.completed_at,gt.updated_at,gt.created_at)
from public.gateway_transactions gt
where gt.funnel_id is not null

union all

select
  'gateway_attempt:'||ga.id::text,
  ga.organization_id,
  ga.user_id,
  gt.funnel_id,
  'gateway_attempt',
  'payment',
  'gateway_attempt',
  ga.status,
  case
    when ga.failure_class is not null or ga.error_message is not null or lower(ga.status) ~ '(fail|error|declin)' then 'error'
    when lower(ga.status) ~ '(pending|processing|retry|created)' then 'warning'
    when lower(ga.status) ~ '(approv|paid|success|complet)' then 'success'
    else 'info'
  end,
  gt.amount,
  gt.currency,
  nullif(gt.metadata->>'checkout_id',''),
  ga.transaction_id::text,
  ga.gateway_id,
  ga.external_transaction_id,
  coalesce(ga.error_message,ga.failure_class,ga.decision_reason),
  jsonb_build_object(
    'gateway_name',ga.gateway_name,'attempt_order',ga.attempt_order,'response_code',ga.response_code,
    'failure_class',ga.failure_class,'decision_reason',ga.decision_reason,'provider_request_id',ga.provider_request_id,'duration_ms',ga.duration_ms
  ),
  coalesce(ga.completed_at,ga.updated_at,ga.created_at)
from public.gateway_payment_attempts ga
join public.gateway_transactions gt on gt.id=ga.transaction_id
where gt.funnel_id is not null

union all

select
  'sale:'||s.id::text,
  s.organization_id,
  s.user_id,
  s.funnel_id,
  'sale',
  'sale',
  'sale_'||coalesce(s.status,'recorded'),
  coalesce(s.status,'recorded'),
  case
    when lower(coalesce(s.status,'')) ~ '(fail|error|chargeback|refund|cancel)' then 'error'
    when lower(coalesce(s.status,'')) ~ '(pending|processing)' then 'warning'
    when lower(coalesce(s.status,'')) ~ '(approv|paid|success|complet)' then 'success'
    else 'info'
  end,
  s.amount,
  s.currency,
  s.checkout_id::text,
  s.transaction_id::text,
  s.gateway_id,
  s.external_id,
  nullif(s.data->>'error_message',''),
  coalesce(s.data,'{}'::jsonb)||coalesce(s.attribution,'{}'::jsonb),
  coalesce(s.occurred_at,s.created_at)
from public.sales s
where s.funnel_id is not null

union all

select
  'transaction_audit:'||ta.id::text,
  gt.organization_id,
  gt.user_id,
  gt.funnel_id,
  'transaction_audit',
  'payment',
  ta.event_type,
  ta.status,
  case
    when lower(ta.status) ~ '(fail|error|declin|rejected)' then 'error'
    when lower(ta.status) ~ '(pending|processing|retry)' then 'warning'
    else 'info'
  end,
  gt.amount,
  gt.currency,
  nullif(gt.metadata->>'checkout_id',''),
  ta.transaction_id::text,
  gt.gateway_id,
  gt.external_id,
  coalesce(nullif(ta.metadata->>'error',''),nullif(ta.metadata->>'message','')),
  ta.metadata||jsonb_build_object('audit_source',ta.source,'idempotency_key',ta.idempotency_key),
  ta.created_at
from public.transaction_audit_events ta
join public.gateway_transactions gt on gt.id=ta.transaction_id
where gt.funnel_id is not null

union all

select
  'drift:'||d.id::text,
  d.organization_id,
  f.user_id,
  d.funnel_id,
  'funnel_control',
  'integration_health',
  'gateway_drift',
  d.status,
  case when d.status='open' then 'error' else 'success' end,
  null::numeric,
  null::text,
  null::text,
  null::text,
  coalesce(d.observed_gateway_id,d.expected_gateway_id),
  d.observed_remote_gateway_ref,
  case when d.status='open' then 'Gateway remota divergente do estado desejado.' else 'Divergência de gateway resolvida.' end,
  d.details||jsonb_build_object(
    'expected_gateway_id',d.expected_gateway_id,'observed_gateway_id',d.observed_gateway_id,
    'correlation_id',d.correlation_id,'resolved_at',d.resolved_at
  ),
  coalesce(d.last_seen_at,d.detected_at)
from public.funnel_control_drift_events d
join public.funnels f on f.id=d.funnel_id

union all

select
  'command:'||t.id::text,
  t.organization_id,
  f.user_id,
  t.funnel_id,
  'funnel_control',
  'gateway_control',
  'gateway_command',
  t.status,
  case
    when t.status in ('failed','blocked','cancelled','preflight_failed') then 'error'
    when t.status in ('retry','queued','claimed','applying','verifying') then 'warning'
    when t.status in ('verified','succeeded','preflight_succeeded') then 'success'
    else 'info'
  end,
  null::numeric,
  null::text,
  null::text,
  null::text,
  t.target_gateway_id,
  t.target_remote_gateway_ref,
  t.last_error_message,
  jsonb_build_object(
    'batch_id',t.batch_id,'previous_gateway_id',t.previous_gateway_id,
    'previous_remote_gateway_ref',t.previous_remote_gateway_ref,'attempt_count',t.attempt_count,
    'max_attempts',t.max_attempts,'correlation_id',t.correlation_id,'last_error_code',t.last_error_code,
    'remote_before',t.remote_before,'remote_after',t.remote_after
  ),
  coalesce(t.completed_at,t.verified_at,t.updated_at,t.created_at)
from public.funnel_command_targets t
join public.funnels f on f.id=t.funnel_id

union all

select
  'connection:'||fc.id::text,
  fc.organization_id,
  fc.user_id,
  fc.funnel_id,
  'funnel_connection',
  'integration_health',
  'connector_health',
  coalesce(fc.health_status,fc.control_status,'unknown'),
  case
    when fc.last_error is not null or fc.health_status='unhealthy' or fc.control_status='error' then 'error'
    when fc.health_status in ('unknown','degraded') or fc.control_status in ('degraded','syncing','read_only') then 'warning'
    when fc.health_status='healthy' or fc.control_status='ready' then 'success'
    else 'info'
  end,
  null::numeric,
  null::text,
  null::text,
  null::text,
  fc.observed_gateway_id,
  fc.remote_funnel_id,
  fc.last_error,
  jsonb_build_object(
    'adapter_key',fc.adapter_key,'remote_base_url',fc.remote_base_url,'remote_funnel_id',fc.remote_funnel_id,
    'capabilities',fc.capabilities,'write_enabled',fc.write_enabled,'control_status',fc.control_status,
    'health_status',fc.health_status,'desired_gateway_id',fc.desired_gateway_id,
    'observed_gateway_id',fc.observed_gateway_id,'last_verified_at',fc.last_verified_at
  ),
  coalesce(fc.last_verified_at,fc.updated_at,fc.created_at)
from public.funnel_connections fc
where fc.funnel_id is not null;

revoke all on public.v_funnel_operational_timeline from anon;
grant select on public.v_funnel_operational_timeline to authenticated;
