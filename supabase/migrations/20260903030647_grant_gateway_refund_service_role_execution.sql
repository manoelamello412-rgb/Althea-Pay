-- The refund Edge Function uses the existing service-role-only transaction transition RPC.
-- Keep no direct public execution path for the state transition itself.
revoke execute on function public.transition_gateway_transaction_status(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.transition_gateway_transaction_status(uuid, uuid, text, text, text) to service_role;