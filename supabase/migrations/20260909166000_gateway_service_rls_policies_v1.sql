drop policy if exists gateway_webhook_events_service_all on public.gateway_webhook_events;
create policy gateway_webhook_events_service_all on public.gateway_webhook_events for all to service_role using (true) with check (true);
drop policy if exists gateway_webhook_secrets_service_all on public.gateway_webhook_secrets;
create policy gateway_webhook_secrets_service_all on public.gateway_webhook_secrets for all to service_role using (true) with check (true);
