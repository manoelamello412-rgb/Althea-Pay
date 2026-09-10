REVOKE INSERT, UPDATE, DELETE ON public.gateway_transactions FROM anon, authenticated;
GRANT SELECT ON public.gateway_transactions TO authenticated;
DROP POLICY IF EXISTS gateway_transactions_owner ON public.gateway_transactions;
CREATE POLICY gateway_transactions_select_own
ON public.gateway_transactions
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));
