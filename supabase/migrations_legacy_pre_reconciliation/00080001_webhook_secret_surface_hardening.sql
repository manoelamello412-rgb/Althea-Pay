begin;

-- Webhook signing secrets are stored in Supabase Vault. The legacy plaintext
-- column must never be reachable through the browser/Data API roles.
revoke all on table public.webhook_integrations from anon, authenticated;
grant select, insert, update, delete on table public.webhook_integrations to service_role;

alter function public.get_webhook_integration(text)
  security definer set search_path = public, vault;
revoke execute on function public.get_webhook_integration(text) from public, anon, authenticated;
grant execute on function public.get_webhook_integration(text) to service_role;

revoke execute on function public.store_webhook_secret(text,text) from public, anon, authenticated;
grant execute on function public.store_webhook_secret(text,text) to service_role;

revoke execute on function public.update_webhook_secret(uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_webhook_secret(uuid,text,text) to service_role;

commit;
