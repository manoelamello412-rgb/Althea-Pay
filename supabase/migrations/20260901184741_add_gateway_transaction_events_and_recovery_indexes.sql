create index if not exists idx_gateway_transactions_funnel_status_created on public.gateway_transactions (funnel_id, status, created_at desc);
create index if not exists idx_gateway_transactions_idempotency_user on public.gateway_transactions (user_id, idempotency_key);
create index if not exists idx_checkout_sessions_abandoned on public.checkout_sessions (user_id, status, updated_at desc) where status in ('pending','started','abandoned');
create index if not exists idx_checkout_events_checkout_created on public.checkout_events (checkout_id, created_at desc);
create index if not exists idx_webhook_deliveries_status_created on public.webhook_deliveries (status, created_at desc);
