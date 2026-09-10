create index if not exists crm_conversations_user_updated_idx on public.crm_conversations(user_id,updated_at desc);
create index if not exists crm_conversations_user_status_updated_idx on public.crm_conversations(user_id,status,updated_at desc);
create index if not exists crm_conversations_user_unread_updated_idx on public.crm_conversations(user_id,unread_count,updated_at desc) where unread_count > 0;
create index if not exists crm_conversations_user_assigned_updated_idx on public.crm_conversations(user_id,assigned_to,updated_at desc);
create index if not exists crm_conversations_user_transaction_idx on public.crm_conversations(user_id,transaction_id) where transaction_id is not null;
create index if not exists crm_messages_conversation_created_idx on public.crm_messages(conversation_id,created_at asc);
create index if not exists crm_messages_user_created_idx on public.crm_messages(user_id,created_at desc);
create index if not exists crm_webhook_events_user_received_idx on public.crm_webhook_events(user_id,received_at desc);
create index if not exists crm_webhook_events_user_transaction_idx on public.crm_webhook_events(user_id,transaction_id) where transaction_id is not null;
create index if not exists crm_webhook_events_user_email_idx on public.crm_webhook_events(user_id,lower(buyer_email)) where buyer_email is not null;
create index if not exists sales_user_transaction_idx on public.sales(user_id,transaction_id) where transaction_id is not null;

create or replace function public.crm_operator_mark_read(p_conversation_id uuid) returns public.crm_conversations language plpgsql security definer set search_path=public as $$
declare
 v_user_id uuid:=auth.uid();
 v_conversation public.crm_conversations;
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 update public.crm_conversations
 set unread_count=0,updated_at=now()
 where id=p_conversation_id and user_id=v_user_id
 returning * into v_conversation;
 if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
 return v_conversation;
end; $$;
revoke all on function public.crm_operator_mark_read(uuid) from public,anon;
grant execute on function public.crm_operator_mark_read(uuid) to authenticated;
