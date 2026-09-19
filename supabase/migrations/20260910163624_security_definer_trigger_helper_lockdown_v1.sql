REVOKE EXECUTE ON FUNCTION public.sync_checkout_chat_state_from_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_checkout_chat_state_from_event() TO service_role;