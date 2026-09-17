-- Harden SECURITY DEFINER surfaces without breaking intentionally public checkout/chat RPCs.

alter view public.v_funnel_commercial_context set (security_invoker = true);

revoke all on function public.add_funnel_step(text,text,text,jsonb) from public, anon;
grant execute on function public.add_funnel_step(text,text,text,jsonb) to authenticated;

revoke all on function public.assign_funnel_offer_step(uuid,uuid) from public, anon;
grant execute on function public.assign_funnel_offer_step(uuid,uuid) to authenticated;

revoke all on function public.configure_funnel_checkout_step(uuid,uuid,jsonb) from public, anon;
grant execute on function public.configure_funnel_checkout_step(uuid,uuid,jsonb) to authenticated;

revoke all on function public.provision_funnel_commercial_atomic(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.provision_funnel_commercial_atomic(text,text,text,text,text,text,text) to authenticated;

revoke all on function public.update_funnel_step(uuid,text,text,jsonb) from public, anon;
grant execute on function public.update_funnel_step(uuid,text,text,jsonb) to authenticated;

-- Credential plaintext resolution is server-only; the implementation also enforces service_role.
revoke all on function public.resolve_gateway_credential(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential(uuid,uuid) to service_role;

-- Public checkout now polls through the server route, which validates session id + idempotency key.
revoke all on function public.get_checkout_transaction_status(uuid) from public, anon;
grant execute on function public.get_checkout_transaction_status(uuid) to authenticated, service_role;

-- Trigger/projection helper must not be callable from PostgREST clients.
revoke all on function public.project_public_checkout_sale() from public, anon, authenticated;
grant execute on function public.project_public_checkout_sale() to service_role;
