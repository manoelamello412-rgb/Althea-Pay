begin;
-- Credential mutation endpoints are intentionally authenticated, but the legacy credential API
-- is not allowed to become a cross-tenant secret reader. Keep the listing surface backend-only.
revoke all on function public.list_gateway_credentials() from public, anon, authenticated;
grant execute on function public.list_gateway_credentials() to service_role;
-- Explicitly keep provider-definition registration backend-only.
revoke all on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text) to service_role;
commit;