-- ALTHEA CORE 0010
-- Database-level protection for concurrent webhook/event delivery.
-- Additive and safe to re-run.

create unique index if not exists integration_events_event_key_unique
  on public.integration_events (event_key)
  where event_key is not null;

create index if not exists webhook_deliveries_integration_created_idx
  on public.webhook_deliveries (integration_id, created_at desc)
  where integration_id is not null;

create index if not exists webhook_deliveries_status_created_idx
  on public.webhook_deliveries (status, created_at desc);

create index if not exists integration_events_status_created_idx
  on public.integration_events (status, created_at desc);

create index if not exists gateway_transactions_external_idx
  on public.gateway_transactions (external_id, created_at desc)
  where external_id is not null;
