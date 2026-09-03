revoke all on table public.webhook_integrations from anon, authenticated;
grant select, insert, update, delete on table public.webhook_integrations to service_role;
revoke all on function public.get_webhook_integration(text) from public, anon, authenticated;
grant execute on function public.get_webhook_integration(text) to service_role;
