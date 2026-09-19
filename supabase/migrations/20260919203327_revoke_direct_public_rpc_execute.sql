-- Phase B of the public checkout/chat hardening rollout.
-- Public browser access now goes through the Vercel server boundary, where
-- validation and database-backed rate limiting are enforced. Keep these
-- SECURITY DEFINER RPCs executable only by the trusted server role.

revoke execute on function public.get_public_checkout_context(text,uuid)
  from public, anon, authenticated;

revoke execute on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated;

revoke execute on function public.crm_public_conversation(text)
  from public, anon, authenticated;

revoke execute on function public.crm_public_message(text,text)
  from public, anon, authenticated;

grant execute on function public.get_public_checkout_context(text,uuid)
  to service_role;

grant execute on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text)
  to service_role;

grant execute on function public.crm_public_conversation(text)
  to service_role;

grant execute on function public.crm_public_message(text,text)
  to service_role;
