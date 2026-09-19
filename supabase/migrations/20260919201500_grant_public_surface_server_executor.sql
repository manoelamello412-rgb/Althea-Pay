-- Phase A of the public checkout/chat hardening rollout.
-- Grant the trusted server executor before browser-direct EXECUTE grants are removed
-- in a follow-up migration after the server boundary is deployed and verified.

grant execute on function public.get_public_checkout_context(text,uuid) to service_role;
grant execute on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text) to service_role;
grant execute on function public.crm_public_conversation(text) to service_role;
grant execute on function public.crm_public_message(text,text) to service_role;
