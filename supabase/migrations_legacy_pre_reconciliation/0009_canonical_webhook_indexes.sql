-- ALTHEA CORE 0009
-- Supporting indexes for the canonical webhook -> integration_events -> sales path.
-- This migration is additive and does not remove legacy tables.

create index if not exists integration_events_gateway_created_idx
  on public.integration_events(gateway_connection_id, created_at desc);

create index if not exists integration_events_funnel_created_idx
  on public.integration_events(funnel_id, created_at desc);

create index if not exists sales_gateway_created_idx
  on public.sales(gateway_connection_id, created_at desc);

create index if not exists sales_funnel_created_idx
  on public.sales(funnel_id, created_at desc);

create index if not exists sales_customer_created_idx
  on public.sales(customer_id, created_at desc);
