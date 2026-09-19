begin;
-- Gateway credential/token/override mutation functions remain callable only by authenticated users when they are tenant-scoped;
-- sensitive credential listing/resolution and webhook secret writes are service-role only.
revoke all on function public.list_gateway_credentials() from public, anon, authenticated;
grant execute on function public.list_gateway_credentials() to service_role;
revoke all on function public.upsert_gateway_credential(text,text,jsonb,boolean,integer) from public, anon;
grant execute on function public.upsert_gateway_credential(text,text,jsonb,boolean,integer) to authenticated, service_role;
revoke all on function public.upsert_gateway_webhook_secret(text,text) from public, anon;
grant execute on function public.upsert_gateway_webhook_secret(text,text) to authenticated, service_role;
revoke all on function public.register_gateway_payment_token_link(uuid,text,text,text,text) from public, anon;
grant execute on function public.register_gateway_payment_token_link(uuid,text,text,text,text) to authenticated, service_role;
revoke all on function public.revoke_gateway_payment_token_link(uuid) from public, anon;
grant execute on function public.revoke_gateway_payment_token_link(uuid) to authenticated, service_role;
revoke all on function public.rotate_gateway_payment_token_link(uuid,text,text) from public, anon;
grant execute on function public.rotate_gateway_payment_token_link(uuid,text,text) to authenticated, service_role;
-- Dynamic provider registration must never be an end-user capability.
revoke all on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) to service_role;
-- Keep checkout/routing controls available to signed-in tenants; implementation must enforce auth.uid tenant ownership.
revoke all on function public.mutate_gateway_checkout_price(uuid,uuid,numeric,text,text,text) from public, anon;
grant execute on function public.mutate_gateway_checkout_price(uuid,uuid,numeric,text,text,text) to authenticated, service_role;
revoke all on function public.set_gateway_routing_override(text,text,text,timestamptz) from public, anon;
grant execute on function public.set_gateway_routing_override(text,text,text,timestamptz) to authenticated, service_role;
revoke all on function public.set_gateway_routing_split_policy(text,text,jsonb) from public, anon;
grant execute on function public.set_gateway_routing_split_policy(text,text,jsonb) to authenticated, service_role;
commit;