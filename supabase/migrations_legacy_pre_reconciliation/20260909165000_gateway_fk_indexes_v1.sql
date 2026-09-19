create index if not exists gateway_refunds_gateway_id_idx on public.gateway_refunds(gateway_id);
create index if not exists gateway_webhook_secrets_user_id_idx on public.gateway_webhook_secrets(user_id);
create index if not exists gateways_credential_id_idx on public.gateways(credential_id);
