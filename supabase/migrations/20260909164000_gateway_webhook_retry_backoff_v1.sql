alter table public.gateway_webhook_events add column if not exists next_attempt_at timestamptz;
create index if not exists gateway_webhook_events_retry_idx on public.gateway_webhook_events(status,next_attempt_at,received_at);
update public.gateway_webhook_events set next_attempt_at=coalesce(next_attempt_at,received_at) where next_attempt_at is null;
