begin;
-- Provider event IDs and provider transaction IDs are scoped to a concrete gateway.
-- A global (provider,event_id) uniqueness rule can incorrectly deduplicate two tenants/gateways.
drop index if exists public.gateway_webhook_events_provider_event_id_key;
create unique index if not exists gateway_webhook_events_gateway_provider_event_id_key
  on public.gateway_webhook_events (gateway_id, provider, provider_event_id)
  where gateway_id is not null;
create unique index if not exists gateway_webhook_events_legacy_provider_event_id_key
  on public.gateway_webhook_events (provider, provider_event_id)
  where gateway_id is null;
-- External transaction IDs are likewise scoped by gateway; keep the canonical gateway-scoped authority.
drop index if exists public.gateway_transactions_user_external_unique;
commit;