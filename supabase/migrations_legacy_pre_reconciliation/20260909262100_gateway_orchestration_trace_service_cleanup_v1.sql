CREATE OR REPLACE FUNCTION public.gateway_orchestration_trace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'gateway_orchestration_trace_tenant_immutable';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.gateway_orchestration_trace_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_orchestration_trace_guard() TO service_role;
