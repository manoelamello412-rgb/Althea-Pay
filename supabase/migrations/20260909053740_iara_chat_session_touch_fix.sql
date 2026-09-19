drop trigger if exists chat_messages_touch_session_updated_at on public.chat_messages;
create or replace function public.touch_chat_session_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions set updated_at = now() where id = new.session_id and user_id = new.user_id;
  return new;
end;
$$;
revoke all on function public.touch_chat_session_on_message() from public;
grant execute on function public.touch_chat_session_on_message() to service_role;
create trigger chat_messages_touch_session_updated_at after insert on public.chat_messages for each row execute function public.touch_chat_session_on_message();