create or replace function public.link_gateway_transaction_to_attempts()
returns trigger
language plpgsql
security definer
set search_path=public
as $fn$
declare m jsonb:=coalesce(new.routing_metadata,'{}'::jsonb); pid uuid; pver bigint;
begin
  pid:=case when nullif(m->>'policy_id','') is null then null else (m->>'policy_id')::uuid end;
  pver:=case when nullif(m->>'policy_version','') is null then null else (m->>'policy_version')::bigint end;
  update public.gateway_payment_attempts a
  set transaction_id=new.id,
      routing_policy_id=coalesce(a.routing_policy_id,pid),
      routing_policy_version=coalesce(a.routing_policy_version,pver),
      decision_reason=coalesce(a.decision_reason,case when a.status='approved' then 'gateway_selected' when a.failure_class is not null then 'gateway_attempt_failed' else null end),
      provider_request_id=coalesce(a.provider_request_id,a.external_transaction_id),
      duration_ms=coalesce(a.duration_ms,greatest(0,extract(epoch from (coalesce(a.completed_at,a.updated_at)-a.created_at)*1000)::integer))
  where a.user_id=new.user_id
    and a.gateway_id::text=new.gateway_id
    and a.transaction_id is null
    and a.idempotency_key like new.idempotency_key||':%'
    and a.attempt_order=(select max(a2.attempt_order) from public.gateway_payment_attempts a2 where a2.user_id=new.user_id and a2.idempotency_key like new.idempotency_key||':%');
  return new;
end;
$fn$;
revoke all on function public.link_gateway_transaction_to_attempts() from public,anon,authenticated;
grant execute on function public.link_gateway_transaction_to_attempts() to service_role;
drop trigger if exists trg_link_gateway_transaction_to_attempts on public.gateway_transactions;
create trigger trg_link_gateway_transaction_to_attempts after insert on public.gateway_transactions for each row execute function public.link_gateway_transaction_to_attempts();