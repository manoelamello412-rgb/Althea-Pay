-- Harden confirmed exposed SECURITY DEFINER surfaces without changing intentional public checkout/chat RPCs.
revoke execute on function public.add_funnel_step(text, text, text, jsonb) from public, anon;
revoke execute on function public.assign_funnel_offer_step(uuid, uuid) from public, anon;
revoke execute on function public.configure_funnel_checkout_step(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.provision_funnel_commercial_atomic(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.update_funnel_step(uuid, text, text, jsonb) from public, anon;

revoke execute on function public.resolve_gateway_credential(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential(uuid, uuid) to service_role;

-- Trigger functions are invoked by their trigger; browser/API roles do not need direct EXECUTE.
revoke execute on function public.project_public_checkout_sale() from public, anon, authenticated;
grant execute on function public.project_public_checkout_sale() to service_role;

-- The commercial context view must honor the querying user's RLS.
grant select on table public.funnel_offers to authenticated;
grant select on table public.funnel_gateway_bindings to authenticated;
alter view public.v_funnel_commercial_context set (security_invoker = true);