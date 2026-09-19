create unique index if not exists integration_events_user_external_unique on public.integration_events (user_id, external_id) where external_id is not null;
create index if not exists webhook_deliveries_integration_status_idx on public.webhook_deliveries (integration_id, status, created_at desc);
create index if not exists webhook_deliveries_event_idx on public.webhook_deliveries (event_type, created_at desc);
create unique index if not exists checkout_events_checkout_external_unique on public.checkout_events (checkout_id, external_id) where external_id is not null;