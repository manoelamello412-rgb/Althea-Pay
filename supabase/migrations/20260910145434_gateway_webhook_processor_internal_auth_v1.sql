CREATE OR REPLACE FUNCTION public.verify_althea_internal_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE v_secret text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_secret IS NULL OR length(p_secret) < 16 THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='ALTHEA_INTERNAL_SECRET' LIMIT 1;
  RETURN v_secret IS NOT NULL AND p_secret = v_secret;
END;
$function$;
REVOKE ALL ON FUNCTION public.verify_althea_internal_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_althea_internal_secret(text) TO service_role;