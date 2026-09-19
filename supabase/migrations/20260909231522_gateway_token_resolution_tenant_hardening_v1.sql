CREATE OR REPLACE FUNCTION public.resolve_gateway_payment_token(p_link_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,vault
AS $$
DECLARE v_ref text; v_token text;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'tenant_context_required'; END IF;
  SELECT secret_ref INTO v_ref
  FROM public.gateway_payment_token_links
  WHERE id=p_link_id AND user_id=p_user_id AND status='active';
  IF v_ref IS NULL THEN RAISE EXCEPTION 'payment_token_not_found'; END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id=v_ref::uuid;
  IF v_token IS NULL THEN RAISE EXCEPTION 'payment_token_secret_missing'; END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_gateway_payment_token(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.resolve_gateway_payment_token(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_gateway_payment_token(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_gateway_payment_token_link(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_user uuid:=auth.uid(); v_count integer;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 UPDATE public.gateway_payment_token_links
 SET status='revoked', updated_at=now()
 WHERE id=p_link_id AND user_id=v_user AND status='active';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_gateway_payment_token_link(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_gateway_payment_token_link(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.rotate_gateway_payment_token_link(p_link_id uuid,p_token text,p_token_fingerprint text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,vault
AS $$
DECLARE v_user uuid:=auth.uid(); v_old public.gateway_payment_token_links%ROWTYPE; v_secret uuid; v_new uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_token IS NULL OR length(trim(p_token))<1 OR length(p_token)>4096 THEN RAISE EXCEPTION 'invalid_provider_token'; END IF;
 SELECT * INTO v_old FROM public.gateway_payment_token_links WHERE id=p_link_id AND user_id=v_user AND status='active' FOR UPDATE;
 IF v_old.id IS NULL THEN RAISE EXCEPTION 'payment_token_not_found'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.gateways WHERE id=v_old.gateway_id AND user_id=v_user AND lower(status) IN ('connected','degraded')) THEN RAISE EXCEPTION 'gateway_not_eligible'; END IF;
 v_secret:=vault.create_secret(p_token,'althea_gateway_token_'||gen_random_uuid()::text,'Rotated provider payment token; never a PAN/CVV');
 UPDATE public.gateway_payment_token_links SET status='revoked',updated_at=now() WHERE id=v_old.id;
 INSERT INTO public.gateway_payment_token_links(user_id,instrument_id,gateway_id,provider,secret_ref,token_fingerprint,status)
 VALUES(v_user,v_old.instrument_id,v_old.gateway_id,v_old.provider,v_secret::text,p_token_fingerprint,'active') RETURNING id INTO v_new;
 RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_gateway_payment_token_link(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rotate_gateway_payment_token_link(uuid,text,text) TO authenticated,service_role;