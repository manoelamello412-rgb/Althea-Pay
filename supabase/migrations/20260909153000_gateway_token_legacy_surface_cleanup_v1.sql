drop function if exists public.resolve_gateway_payment_token(uuid);
revoke execute on function public.rotate_gateway_payment_token_link(uuid,text,text) from anon;
revoke execute on function public.revoke_gateway_payment_token_link(uuid) from anon;
