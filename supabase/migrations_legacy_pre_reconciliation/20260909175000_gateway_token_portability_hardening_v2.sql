CREATE OR REPLACE FUNCTION public.create_gateway_payment_instrument(p_customer_ref text,p_instrument_fingerprint text DEFAULT NULL,p_brand text DEFAULT NULL,p_last4 text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_id uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_customer_ref IS NULL OR length(trim(p_customer_ref))<1 OR length(p_customer_ref)>300 THEN RAISE EXCEPTION 'invalid_customer_ref'; END IF;
 IF p_last4 IS NOT NULL AND p_last4 !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'invalid_last4'; END IF;
 INSERT INTO public.gateway_payment_instruments(user_id,customer_ref,instrument_fingerprint,brand,last4) VALUES(v_user,trim(p_customer_ref),NULLIF(trim(p_instrument_fingerprint),''),NULLIF(lower(trim(p_brand)),''),NULLIF(trim(p_last4),'')) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_gateway_payment_instrument(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_gateway_payment_instrument(text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) TO authenticated;
COMMENT ON TABLE public.gateway_payment_token_links IS 'Provider token portability map. Secret provider tokens are stored only in Supabase Vault; PAN/CVV are never accepted or stored.';
