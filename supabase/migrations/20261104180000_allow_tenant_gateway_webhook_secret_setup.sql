begin;

-- The RPC is SECURITY DEFINER and enforces auth.uid() plus gateway ownership
-- internally. Allow authenticated tenant users to configure their own
-- gateway-specific webhook token from the dashboard; never grant anon/public.
grant execute on function public.upsert_gateway_webhook_secret(text, text)
  to authenticated;

commit;
