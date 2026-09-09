-- Client roles must never have table-maintenance privileges on the public schema.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_touch_conversation() FROM public;
REVOKE EXECUTE ON FUNCTION public.touch_chat_session_updated_at() FROM public;
REVOKE EXECUTE ON FUNCTION public.touch_merchant_business_profile_updated_at() FROM public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public;
