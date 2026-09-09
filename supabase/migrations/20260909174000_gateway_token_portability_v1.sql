CREATE TABLE IF NOT EXISTS public.gateway_payment_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_ref text NOT NULL, instrument_fingerprint text, brand text, last4 text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_instruments_tenant_customer ON public.gateway_payment_instruments(user_id,customer_ref);
ALTER TABLE public.gateway_payment_instruments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_payment_instruments_owner_select ON public.gateway_payment_instruments;
CREATE POLICY gateway_payment_instruments_owner_select ON public.gateway_payment_instruments FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE TABLE IF NOT EXISTS public.gateway_payment_token_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES public.gateway_payment_instruments(id) ON DELETE CASCADE,
  gateway_id text NOT NULL REFERENCES public.gateways(id) ON DELETE CASCADE, provider text NOT NULL,
  secret_ref text NOT NULL, token_fingerprint text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired','invalid')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,instrument_id,gateway_id)
);
CREATE INDEX IF NOT EXISTS idx_gateway_payment_token_links_lookup ON public.gateway_payment_token_links(user_id,instrument_id,status);
ALTER TABLE public.gateway_payment_token_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_payment_token_links_owner_select ON public.gateway_payment_token_links;
CREATE POLICY gateway_payment_token_links_owner_select ON public.gateway_payment_token_links FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.register_gateway_payment_token_link(p_instrument_id uuid,p_gateway_id text,p_provider text,p_token text,p_token_fingerprint text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault AS $$
DECLARE v_user uuid:=auth.uid(); v_secret uuid; v_id uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_token IS NULL OR length(trim(p_token))<1 OR length(p_token)>4096 THEN RAISE EXCEPTION 'invalid_provider_token'; END IF;
 IF NOT EXISTS (SELECT 1 FROM gateway_payment_instruments WHERE id=p_instrument_id AND user_id=v_user) THEN RAISE EXCEPTION 'instrument_not_found'; END IF;
 IF NOT EXISTS (SELECT 1 FROM gateways WHERE id=p_gateway_id AND user_id=v_user AND lower(status) IN ('connected','degraded')) THEN RAISE EXCEPTION 'gateway_not_eligible'; END IF;
 v_secret:=vault.create_secret(p_token,'althea_gateway_token_'||gen_random_uuid()::text,'Provider token for payment instrument; never a PAN/CVV');
 INSERT INTO gateway_payment_token_links(user_id,instrument_id,gateway_id,provider,secret_ref,token_fingerprint,status) VALUES(v_user,p_instrument_id,p_gateway_id,lower(trim(p_provider)),v_secret::text,p_token_fingerprint,'active')
 ON CONFLICT(user_id,instrument_id,gateway_id) DO UPDATE SET provider=excluded.provider,secret_ref=excluded.secret_ref,token_fingerprint=excluded.token_fingerprint,status='active',updated_at=now() RETURNING id INTO v_id;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_gateway_payment_token(p_link_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault AS $$
DECLARE v_ref text; v_token text;
BEGIN SELECT secret_ref INTO v_ref FROM gateway_payment_token_links WHERE id=p_link_id AND status='active'; IF v_ref IS NULL THEN RAISE EXCEPTION 'payment_token_not_found'; END IF; SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id=v_ref::uuid; IF v_token IS NULL THEN RAISE EXCEPTION 'payment_token_secret_missing'; END IF; RETURN v_token; END; $$;
REVOKE ALL ON FUNCTION public.resolve_gateway_payment_token(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_gateway_payment_token(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_gateway_payment_token_link(uuid,text,text,text,text) TO authenticated;
REVOKE ALL ON TABLE public.gateway_payment_token_links FROM anon;
REVOKE ALL ON TABLE public.gateway_payment_instruments FROM anon;
