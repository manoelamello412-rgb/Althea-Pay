begin;

-- Financial/AI execution RPCs must not be directly callable by authenticated clients.
-- Server-side orchestration remains the only authority for these mutations.
revoke execute on function public.crm_execute_ai_action(uuid, text) from authenticated;
revoke execute on function public.prepare_gateway_payment_link(uuid, text, numeric, text, text, text) from authenticated;

commit;
