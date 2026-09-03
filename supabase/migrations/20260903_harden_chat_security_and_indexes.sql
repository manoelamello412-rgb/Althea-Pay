begin;

alter policy crm_conversations_owner on public.crm_conversations
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy crm_messages_owner on public.crm_messages
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create index if not exists crm_messages_user_id_idx on public.crm_messages (user_id);
create index if not exists frontend_funnel_experiments_user_id_idx on public.frontend_funnel_experiments (user_id);
create index if not exists frontend_funnel_recovery_user_id_idx on public.frontend_funnel_recovery (user_id);
create index if not exists frontend_hmac_keys_user_id_idx on public.frontend_hmac_keys (user_id);

alter function public.crm_touch_conversation() set search_path = public;
revoke execute on function public.materialize_funnel_chat_event() from anon, authenticated;

commit;
