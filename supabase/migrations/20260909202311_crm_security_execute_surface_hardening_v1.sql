begin;
revoke execute on function public.crm_mirror_client_event() from public, anon, authenticated;
revoke execute on function public.crm_mirror_sale_event() from public, anon, authenticated;
revoke execute on function public.crm_sync_webhook_event() from public, anon, authenticated;
revoke execute on function public.crm_touch_conversation_from_message() from public, anon, authenticated;
revoke execute on function public.crm_operator_send_message(uuid,text,text) from anon;
revoke execute on function public.crm_operator_set_status(uuid,text) from anon;
commit;