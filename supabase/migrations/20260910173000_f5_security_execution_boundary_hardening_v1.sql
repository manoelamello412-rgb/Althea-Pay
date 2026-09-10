-- F5 security boundary hardening: remove direct client execution of privileged gateway/payment functions.
REVOKE EXECUTE ON FUNCTION public.create_gateway_payment_instrument(text,text,text,text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.mutate_gateway_checkout_price(uuid,uuid,numeric,text,text,text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_gateway_payment_token_link(uuid) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.rotate_gateway_payment_token_link(uuid,text,text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gateway_credential_status(uuid,boolean) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gateway_routing_override(text,text,text,timestamptz) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gateway_routing_split_policy(text,text,jsonb) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_gateway_credential(text,text,jsonb,boolean,integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gateway_payment_instrument(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mutate_gateway_checkout_price(uuid,uuid,numeric,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_gateway_payment_token_link(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_gateway_payment_token_link(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_gateway_credential_status(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_gateway_routing_override(text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_gateway_routing_split_policy(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_gateway_credential(text,text,jsonb,boolean,integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.crm_touch_automation_execution_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.crm_public_conversation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_conversation(text) TO anon;
REVOKE EXECUTE ON FUNCTION public.crm_public_message(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_message(text,text) TO anon;
