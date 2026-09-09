begin;

alter table public.crm_messages add column if not exists client_message_id text;

create unique index if not exists uq_crm_messages_user_client_message
  on public.crm_messages(user_id, client_message_id)
  where client_message_id is not null;

create or replace function public.crm_operator_send_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id text default null
)
returns public.crm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.crm_messages;
  v_message public.crm_messages;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_body = '' then raise exception 'MESSAGE_EMPTY' using errcode = '22023'; end if;
  if length(v_body) > 10000 then raise exception 'MESSAGE_TOO_LONG' using errcode = '22001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));
  if p_client_message_id is not null then
    select * into v_existing from public.crm_messages where user_id=v_user_id and client_message_id=p_client_message_id limit 1;
    if found then return v_existing; end if;
  end if;
  if not exists (select 1 from public.crm_conversations where id=p_conversation_id and user_id=v_user_id) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;
  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id)
  values(p_conversation_id,v_user_id,'outbound','webchat',v_body,jsonb_build_object('source','crm_operator','mutation','atomic'),v_user_id,p_client_message_id)
  returning * into v_message;
  return v_message;
exception when unique_violation then
  if p_client_message_id is not null then
    select * into v_existing from public.crm_messages where user_id=v_user_id and client_message_id=p_client_message_id limit 1;
    if found then return v_existing; end if;
  end if;
  raise;
end;
$$;

create or replace function public.crm_operator_set_status(p_conversation_id uuid,p_status text)
returns public.crm_conversations
language plpgsql
security definer
set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_conversation public.crm_conversations;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_status not in ('open','pending','closed') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
  update public.crm_conversations set status=p_status,updated_at=now() where id=p_conversation_id and user_id=v_user_id returning * into v_conversation;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
  return v_conversation;
end;
$$;

revoke all on function public.crm_operator_send_message(uuid,text,text) from public;
grant execute on function public.crm_operator_send_message(uuid,text,text) to authenticated;
revoke all on function public.crm_operator_set_status(uuid,text) from public;
grant execute on function public.crm_operator_set_status(uuid,text) to authenticated;

commit;
