-- Public checkout status is served through the server payment endpoint with
-- checkout_session_id + idempotency_key validation. Remove direct anonymous RPC access.

revoke execute on function public.get_checkout_transaction_status(uuid) from public, anon;
grant execute on function public.get_checkout_transaction_status(uuid) to authenticated, service_role;
