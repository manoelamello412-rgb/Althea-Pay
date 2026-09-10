create table if not exists public.crm_channel_delivery_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  channel_account_id uuid not null references public.crm_channel_accounts(id) on delete cascade,
  conversation_id uuid references public.crm_conversations(id) on delete set null,
  external_message_id text not null,
  status text not null check(status in ('queued','sent','delivered','read','failed')),
  provider_event jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists crm_channel_delivery_events_account_message_idx on public.crm_channel_delivery_events(channel_account_id,external_message_id,occurred_at desc);
create index if not exists crm_channel_delivery_events_conversation_idx on public.crm_channel_delivery_events(conversation_id,occurred_at desc);
alter table public.crm_channel_delivery_events enable row level security;
drop policy if exists crm_channel_delivery_events_select_own on public.crm_channel_delivery_events;
create policy crm_channel_delivery_events_select_own on public.crm_channel_delivery_events for select using(user_id=auth.uid());
create or replace function public.crm_record_channel_delivery_status(p_channel_account_id uuid,p_external_message_id text,p_status text,p_provider_event jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare n int:=0; uid uuid; cid uuid;
begin
 if p_channel_account_id is null or nullif(trim(p_external_message_id),'') is null then raise exception 'invalid_delivery_status'; end if;
 if p_status not in ('queued','sent','delivered','read','failed') then raise exception 'invalid_delivery_status_value'; end if;
 select a.user_id into uid from public.crm_channel_accounts a where a.id=p_channel_account_id and a.status='active';
 if uid is null then raise exception 'channel_account_not_found'; end if;
 select o.conversation_id into cid from public.crm_channel_message_outbox o where o.channel_account_id=p_channel_account_id and o.external_message_id=p_external_message_id order by o.updated_at desc limit 1;
 insert into public.crm_channel_delivery_events(user_id,channel_account_id,conversation_id,external_message_id,status,provider_event) values(uid,p_channel_account_id,cid,p_external_message_id,p_status,coalesce(p_provider_event,'{}'::jsonb));
 update public.crm_channel_message_outbox set status=case when p_status='failed' then 'failed' when p_status in ('sent','delivered','read') then 'sent' else status end, failed_at=case when p_status='failed' then now() else failed_at end, sent_at=case when p_status in ('sent','delivered','read') then coalesce(sent_at,now()) else sent_at end, last_error=case when p_status='failed' then coalesce(p_provider_event->>'error','provider_delivery_failed') else null end, metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('delivery_status',p_status,'provider_event',coalesce(p_provider_event,'{}'::jsonb)),updated_at=now() where channel_account_id=p_channel_account_id and external_message_id=p_external_message_id;
 get diagnostics n=row_count;
 update public.crm_messages set delivered_at=case when p_status in ('delivered','read') then coalesce(delivered_at,now()) else delivered_at end, metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('delivery_status',p_status,'provider_event',coalesce(p_provider_event,'{}'::jsonb)) where channel_account_id=p_channel_account_id::text and external_message_id=p_external_message_id;
 return jsonb_build_object('updated_outbox_rows',n,'status',p_status,'audit_recorded',true);
end; $$;
revoke all on function public.crm_record_channel_delivery_status(uuid,text,text,jsonb) from public,anon;
grant execute on function public.crm_record_channel_delivery_status(uuid,text,text,jsonb) to service_role;
