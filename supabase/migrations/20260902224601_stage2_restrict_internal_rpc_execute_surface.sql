REVOKE EXECUTE ON FUNCTION public.mark_abandoned_checkouts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_checkouts(integer) TO service_role;
ALTER FUNCTION public.mark_abandoned_checkouts(integer) SET search_path = pg_catalog, public;
REVOKE EXECUTE ON FUNCTION public.set_brand_identity_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;