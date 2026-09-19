-- Canonical Multi-Gateway invariants: provider-neutral, no duplicate configuration model.
ALTER TABLE public.gateway_provider_registry
  ADD CONSTRAINT gateway_provider_registry_adapter_key_nonempty_ck CHECK (length(trim(adapter_key)) > 0);

ALTER TABLE public.gateways
  ADD CONSTRAINT gateways_provider_nonempty_ck CHECK (length(trim(provider)) > 0),
  ADD CONSTRAINT gateways_status_valid_ck CHECK (status IN ('inactive','connected','degraded','disabled','error'));

-- A connected/degraded gateway must resolve to an operational adapter and a credential.
CREATE OR REPLACE FUNCTION public.enforce_gateway_runtime_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_operational boolean; v_adapter text; v_credential uuid;
BEGIN
  IF NEW.status IN ('connected','degraded') THEN
    SELECT operational, adapter_key INTO v_operational, v_adapter
    FROM public.gateway_provider_registry
    WHERE provider_key = lower(trim(NEW.provider)) AND is_active = true;
    IF COALESCE(v_operational,false) IS NOT TRUE OR COALESCE(trim(v_adapter),'') = '' THEN
      RAISE EXCEPTION 'gateway_adapter_not_operational';
    END IF;
    v_credential := NEW.credential_id;
    IF v_credential IS NULL THEN RAISE EXCEPTION 'gateway_credential_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_gateway_credentials c WHERE c.id=v_credential AND c.user_id=NEW.user_id AND c.is_active=true) THEN
      RAISE EXCEPTION 'gateway_credential_tenant_or_status_invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gateway_runtime_contract ON public.gateways;
CREATE TRIGGER trg_gateway_runtime_contract BEFORE INSERT OR UPDATE ON public.gateways FOR EACH ROW EXECUTE FUNCTION public.enforce_gateway_runtime_contract();
REVOKE ALL ON FUNCTION public.enforce_gateway_runtime_contract() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_gateway_runtime_contract() TO service_role;

-- Canonical gateway references only: routing graph may not persist legacy plain `id`.
CREATE OR REPLACE FUNCTION public.assert_canonical_gateway_reference(p_graph jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_graph IS NULL OR jsonb_typeof(p_graph) <> 'object' THEN RAISE EXCEPTION 'routing_graph_object_required'; END IF;
  IF p_graph::text ~ '"id"\s*:' AND p_graph::text !~ '"gateway_id"\s*:' AND p_graph::text !~ '"gatewayId"\s*:' THEN
    RAISE EXCEPTION 'legacy_gateway_reference_forbidden';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_canonical_gateway_reference(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_canonical_gateway_reference(jsonb) TO service_role;