DROP POLICY IF EXISTS gateway_operation_logs_owner ON public.gateway_operation_logs;
REVOKE INSERT, UPDATE, DELETE ON public.gateway_operation_logs FROM anon, authenticated;
GRANT SELECT ON public.gateway_operation_logs TO authenticated;
CREATE POLICY gateway_operation_logs_select_own
ON public.gateway_operation_logs
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));
