create or replace function public.broadcast_operational_change() returns trigger language plpgsql security definer set search_path = public, extensions as $$ begin perform realtime.broadcast_changes('althea:' || coalesce(NEW.user_id, OLD.user_id)::text || ':operations', TG_OP, TG_OP, TG_TABLE_NAME, coalesce(NEW, OLD), case when TG_OP='DELETE' then OLD else NEW end); return coalesce(NEW, OLD); end; $$; 

drop trigger if exists trg_gateway_transactions_realtime on public.gateway_transactions; create trigger trg_gateway_transactions_realtime after insert or update or delete on public.gateway_transactions for each row execute function public.broadcast_operational_change();

drop trigger if exists trg_checkout_sessions_realtime on public.checkout_sessions; create trigger trg_checkout_sessions_realtime after insert or update or delete on public.checkout_sessions for each row execute function public.broadcast_operational_change();

drop trigger if exists trg_chats_realtime on public.chats; create trigger trg_chats_realtime after insert or update or delete on public.chats for each row execute function public.broadcast_operational_change();

drop trigger if exists trg_messages_realtime on public.messages; create trigger trg_messages_realtime after insert or update or delete on public.messages for each row execute function public.broadcast_operational_change();

revoke execute on function public.broadcast_operational_change() from public, anon, authenticated; grant execute on function public.broadcast_operational_change() to postgres;