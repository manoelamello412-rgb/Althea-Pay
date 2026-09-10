create or replace function public.crm_dedupe_outbound_outbox_message() returns trigger language plpgsql security definer set search_path=public as $$ declare existing public.crm_messages; oid text:=new.metadata->>'outbox_id'; begin if new.direction='outbound' and oid is not null then select * into existing from public.crm_messages where user_id=new.user_id and metadata->>'outbox_id'=oid limit 1; if found then return existing; end if; end if; return new; end; $$;
drop trigger if exists trg_crm_outbound_outbox_insert_dedup on public.crm_messages;
create trigger trg_crm_outbound_outbox_insert_dedup before insert on public.crm_messages for each row execute function public.crm_dedupe_outbound_outbox_message();
revoke all on function public.crm_dedupe_outbound_outbox_message() from public,anon,authenticated;
grant execute on function public.crm_dedupe_outbound_outbox_message() to service_role;
