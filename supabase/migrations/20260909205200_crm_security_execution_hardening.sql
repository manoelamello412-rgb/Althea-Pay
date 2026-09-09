-- ALTHEA PAY Chat CRM: explicit RPC execution grants.
-- Public funnel chat remains callable by anonymous visitors; operator and
-- intelligence operations require an authenticated session.

revoke all on function public.crm_public_conversation(text) from public;
revoke all on function public.crm_public_conversation(text) from authenticated;
grant execute on function public.crm_public_conversation(text) to anon;

revoke all on function public.crm_public_message(text,text) from public;
revoke all on function public.crm_public_message(text,text) from authenticated;
grant execute on function public.crm_public_message(text,text) to anon;

revoke all on function public.crm_operator_send_message(uuid,text,text) from public;
grant execute on function public.crm_operator_send_message(uuid,text,text) to authenticated;

revoke all on function public.crm_operator_set_status(uuid,text) from public;
grant execute on function public.crm_operator_set_status(uuid,text) to authenticated;

revoke all on function public.crm_customer_360(uuid) from public;
grant execute on function public.crm_customer_360(uuid) to authenticated;

revoke all on function public.crm_recovery_execute(uuid) from public;
grant execute on function public.crm_recovery_execute(uuid) to authenticated;

revoke all on function public.crm_recovery_opportunities(integer) from public;
grant execute on function public.crm_recovery_opportunities(integer) to authenticated;

revoke all on function public.crm_revenue_intelligence(integer) from public;
grant execute on function public.crm_revenue_intelligence(integer) to authenticated;

revoke all on function public.crm_analytics(integer) from public;
grant execute on function public.crm_analytics(integer) to authenticated;

-- Trigger-only functions are not exposed as an RPC API.
revoke all on function public.crm_mirror_client_event() from public;
revoke all on function public.crm_mirror_sale_event() from public;
revoke all on function public.crm_sync_webhook_event() from public;
revoke all on function public.crm_touch_conversation_from_message() from public;
revoke all on function public.crm_touch_conversation() from public;
