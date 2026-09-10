begin;

revoke execute on function public.enqueue_gateway_payment_link_execution(uuid, uuid, text, text, jsonb) from authenticated;
revoke execute on function public.enqueue_gateway_payment_link_execution(uuid, uuid, text, text, jsonb) from anon;

commit;
