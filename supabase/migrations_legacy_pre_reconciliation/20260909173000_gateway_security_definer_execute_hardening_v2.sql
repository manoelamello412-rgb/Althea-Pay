REVOKE EXECUTE ON FUNCTION public.guard_gateway_transaction_sensitive_payload() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_gateway_refund_financial_journal() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_gateway_financial_journal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_gateway_transaction_sensitive_payload() TO service_role;
GRANT EXECUTE ON FUNCTION public.post_gateway_refund_financial_journal() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_gateway_financial_journal() TO service_role;
