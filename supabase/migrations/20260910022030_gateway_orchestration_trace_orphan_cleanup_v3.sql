CREATE OR REPLACE FUNCTION public._gateway_cleanup_e2e_trace_orphans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.gateway_orchestration_traces
  WHERE transaction_id IS NULL
    AND idempotency_key LIKE 'e2e-trace-%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._gateway_cleanup_e2e_trace_orphans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._gateway_cleanup_e2e_trace_orphans() TO service_role;
SELECT public._gateway_cleanup_e2e_trace_orphans();
DROP FUNCTION public._gateway_cleanup_e2e_trace_orphans();