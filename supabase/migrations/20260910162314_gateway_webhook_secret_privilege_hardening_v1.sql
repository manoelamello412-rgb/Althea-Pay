begin;
-- Webhook secrets are provider credentials. Only the trusted backend may write them.
revoke all on function public.upsert_gateway_webhook_secret(text,text) from public, anon, authenticated;
grant execute on function public.upsert_gateway_webhook_secret(text,text) to service_role;
commit;