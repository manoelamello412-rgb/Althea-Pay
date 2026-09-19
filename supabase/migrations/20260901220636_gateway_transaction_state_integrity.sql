create unique index if not exists gateway_transactions_user_idempotency_unique on public.gateway_transactions (user_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists gateway_transactions_user_external_unique on public.gateway_transactions (user_id, external_id) where external_id is not null;
create index if not exists gateway_transactions_checkout_idx on public.gateway_transactions ((metadata->>'checkout_id'), created_at desc) where metadata ? 'checkout_id';
create index if not exists checkout_sessions_funnel_status_time_idx on public.checkout_sessions (user_id, funnel_id, status, created_at desc);
create index if not exists integration_events_retry_due_idx on public.integration_events (status, next_retry_at) where status in ('retry','pending');