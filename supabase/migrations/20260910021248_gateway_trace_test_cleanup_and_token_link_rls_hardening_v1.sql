BEGIN;
DROP POLICY IF EXISTS gateway_payment_token_links_owner_select ON public.gateway_payment_token_links;
CREATE POLICY gateway_payment_token_links_owner_select ON public.gateway_payment_token_links FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DELETE FROM public.gateway_orchestration_traces WHERE transaction_id IS NULL AND idempotency_key LIKE 'e2e-trace-%';
COMMIT;