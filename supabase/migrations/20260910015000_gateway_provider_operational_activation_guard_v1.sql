CREATE OR REPLACE FUNCTION public.guard_gateway_operational_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operational boolean;
  v_active boolean;
BEGIN
  IF NEW.status IN ('connected','degraded') THEN
    SELECT operational, is_active
      INTO v_operational, v_active
      FROM public.gateway_provider_registry
     WHERE provider_key = lower(trim(NEW.provider));
    IF NOT FOUND OR coalesce(v_active,false) IS NOT TRUE OR coalesce(v_operational,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'gateway_provider_not_operational:%', lower(trim(NEW.provider));
    END IF;
    IF NEW.environment = 'production' AND NEW.credential_id IS NULL THEN
      RAISE EXCEPTION 'gateway_production_credential_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gateway_operational_activation_guard ON public.gateways;
CREATE TRIGGER trg_gateway_operational_activation_guard
BEFORE INSERT OR UPDATE OF provider,environment,status,credential_id ON public.gateways
FOR EACH ROW EXECUTE FUNCTION public.guard_gateway_operational_activation();

REVOKE EXECUTE ON FUNCTION public.guard_gateway_operational_activation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_gateway_operational_activation() TO service_role;
