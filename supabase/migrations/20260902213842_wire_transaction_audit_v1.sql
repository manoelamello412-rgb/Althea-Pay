alter table public.transaction_audit_events alter column organization_id drop not null;

create or replace function public.capture_transaction_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_event_type text;
  v_key text;
  v_tx_id uuid;
  v_meta jsonb := '{}'::jsonb;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  select organization_id into v_org_id from public.organization_members where user_id = v_user_id order by created_at asc limit 1;

  if tg_table_name = 'gateway_transactions' then
    v_tx_id := coalesce(new.id, old.id);
    v_event_type := case when tg_op = 'INSERT' then 'transaction.created' else 'transaction.status_changed' end;
    v_key := coalesce(new.idempotency_key, old.idempotency_key, v_tx_id::text) || ':' || v_event_type || ':' || coalesce(new.status, old.status, 'unknown');
    v_meta := jsonb_build_object('gateway_id', coalesce(new.gateway_id, old.gateway_id), 'external_id', coalesce(new.external_id, old.external_id), 'status', coalesce(new.status, old.status), 'amount', coalesce(new.amount, old.amount), 'currency', coalesce(new.currency, old.currency), 'attempt_count', coalesce(new.attempt_count, old.attempt_count));
  elsif tg_table_name = 'gateway_payment_attempts' then
    v_event_type := case when tg_op = 'INSERT' then 'gateway.attempt.created' else 'gateway.attempt.updated' end;
    v_key := coalesce(new.idempotency_key, old.idempotency_key, coalesce(new.id, old.id)::text) || ':' || v_event_type || ':' || coalesce(new.status, old.status, 'unknown');
    v_meta := jsonb_build_object('gateway_id', coalesce(new.gateway_id, old.gateway_id), 'gateway_name', coalesce(new.gateway_name, old.gateway_name), 'attempt_order', coalesce(new.attempt_order, old.attempt_order), 'status', coalesce(new.status, old.status), 'failure_class', coalesce(new.failure_class, old.failure_class), 'external_transaction_id', coalesce(new.external_transaction_id, old.external_transaction_id));
  elsif tg_table_name = 'transaction_routing_logs' then
    v_event_type := 'routing.completed';
    v_key := coalesce(new.idempotency_key, new.id::text) || ':routing.completed';
    v_meta := jsonb_build_object('status', new.status, 'final_gateway', new.final_gateway, 'failure_class', new.failure_class, 'attempt_count', jsonb_array_length(coalesce(new.gateways_attempted, '[]'::jsonb)));
  elsif tg_table_name = 'integration_events' then
    v_event_type := 'webhook.received';
    v_key := coalesce(new.event_key, new.external_id, new.id::text) || ':webhook.received';
    v_meta := jsonb_build_object('event_type', new.event_type, 'external_id', new.external_id, 'status', new.status, 'integration_id', new.integration_id);
  end if;

  if v_event_type is not null then
    insert into public.transaction_audit_events(organization_id, transaction_id, event_type, idempotency_key, actor_user_id, source, status, metadata)
    values(v_org_id, v_tx_id, v_event_type, v_key, v_user_id, case when tg_table_name = 'integration_events' then 'webhook' else 'transactional_core' end, coalesce(new.status, 'accepted'), v_meta)
    on conflict do nothing;
  end if;
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end;
$$;

revoke all on function public.capture_transaction_audit() from public;

 drop trigger if exists trg_gateway_transactions_audit on public.gateway_transactions;
create trigger trg_gateway_transactions_audit after insert or update of status, external_id, failure_code, attempt_count on public.gateway_transactions for each row execute function public.capture_transaction_audit();

drop trigger if exists trg_gateway_payment_attempts_audit on public.gateway_payment_attempts;
create trigger trg_gateway_payment_attempts_audit after insert or update of status, failure_class, external_transaction_id on public.gateway_payment_attempts for each row execute function public.capture_transaction_audit();

drop trigger if exists trg_transaction_routing_audit on public.transaction_routing_logs;
create trigger trg_transaction_routing_audit after insert on public.transaction_routing_logs for each row execute function public.capture_transaction_audit();

drop trigger if exists trg_integration_events_audit on public.integration_events;
create trigger trg_integration_events_audit after insert on public.integration_events for each row execute function public.capture_transaction_audit();

create index if not exists idx_transaction_audit_tx_created on public.transaction_audit_events(transaction_id, created_at desc) where transaction_id is not null;
create index if not exists idx_transaction_audit_event_created on public.transaction_audit_events(event_type, created_at desc);
