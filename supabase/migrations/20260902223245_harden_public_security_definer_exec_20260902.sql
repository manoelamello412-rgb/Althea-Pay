revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from public;
revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from anon;
revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from authenticated;
grant execute on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) to service_role;

revoke all on function public.record_platform_health_check(text,text,jsonb) from public;
revoke all on function public.record_platform_health_check(text,text,jsonb) from anon;
revoke all on function public.record_platform_health_check(text,text,jsonb) from authenticated;
grant execute on function public.record_platform_health_check(text,text,jsonb) to service_role;

revoke all on function public.transition_gateway_transaction(uuid,text,text) from public;
revoke all on function public.transition_gateway_transaction(uuid,text,text) from anon;
revoke all on function public.transition_gateway_transaction(uuid,text,text) from authenticated;
grant execute on function public.transition_gateway_transaction(uuid,text,text) to service_role;
