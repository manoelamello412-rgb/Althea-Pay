create table if not exists public.crm_webhook_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text, transaction_id text, status text not null, error_reason text,
  buyer_email text, buyer_name text, payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now()), processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.crm_conversations add column if not exists public_token text;
alter table public.crm_conversations add column if not exists last_message_at timestamptz;
alter table public.crm_conversations add column if not exists last_message_direction text;
alter table public.crm_conversations add column if not exists unread_count integer not null default 0;
alter table public.crm_conversations add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_messages add column if not exists sender_id uuid;
alter table public.crm_messages add column if not exists sender_name text;
alter table public.crm_messages add column if not exists delivered_at timestamptz;

create unique index if not exists uq_crm_webhook_events_user_idempotency on public.crm_webhook_events(user_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists uq_crm_conversations_public_token on public.crm_conversations(public_token) where public_token is not null;
create index if not exists idx_crm_webhook_events_user_received on public.crm_webhook_events(user_id,received_at desc);
create index if not exists idx_crm_conversations_user_updated on public.crm_conversations(user_id,updated_at desc);
create index if not exists idx_crm_conversations_funnel on public.crm_conversations(user_id,funnel_id);
create index if not exists idx_crm_messages_conversation_created on public.crm_messages(conversation_id,created_at);

alter table public.crm_webhook_events enable row level security;
drop policy if exists crm_webhook_events_select on public.crm_webhook_events;
create policy crm_webhook_events_select on public.crm_webhook_events for select to authenticated using (user_id=auth.uid());
grant select on public.crm_webhook_events to authenticated;

create or replace function public.crm_touch_conversation_from_message()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.crm_conversations set updated_at=timezone('utc',now()),last_message_at=new.created_at,last_message_direction=new.direction,unread_count=case when new.direction='inbound' then unread_count+1 else 0 end where id=new.conversation_id and user_id=new.user_id;
  return new;
end;
$$;
drop trigger if exists trg_crm_message_touch_conversation on public.crm_messages;
create trigger trg_crm_message_touch_conversation after insert on public.crm_messages for each row execute function public.crm_touch_conversation_from_message();

create or replace function public.crm_public_conversation(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb; m jsonb;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if;
  select jsonb_build_object('id',x.id,'funnel_id',x.funnel_id,'product_id',x.product_id,'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'status',x.status,'updated_at',x.updated_at) into c from public.crm_conversations x where x.public_token=p_token limit 1;
  if c is null then return jsonb_build_object('error','not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'direction',x.direction,'channel',x.channel,'body',x.body,'created_at',x.created_at) order by x.created_at asc),'[]'::jsonb) into m from public.crm_messages x join public.crm_conversations c2 on c2.id=x.conversation_id where c2.public_token=p_token;
  return jsonb_build_object('conversation',c,'messages',coalesce(m,'[]'::jsonb));
end;
$$;
revoke all on function public.crm_public_conversation(text) from public,anon,authenticated;
grant execute on function public.crm_public_conversation(text) to anon,authenticated;

create or replace function public.crm_public_message(p_token text,p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; uid uuid; st text;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if;
  if p_body is null or length(trim(p_body))=0 or length(p_body)>4000 then return jsonb_build_object('error','invalid_message'); end if;
  select id,user_id,status into cid,uid,st from public.crm_conversations where public_token=p_token limit 1;
  if cid is null then return jsonb_build_object('error','not_found'); end if;
  if st='closed' then return jsonb_build_object('error','conversation_closed'); end if;
  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) values(cid,uid,'inbound','webchat',trim(p_body),jsonb_build_object('source','funnel_public_chat'),timezone('utc',now()));
  return jsonb_build_object('accepted',true);
end;
$$;
revoke all on function public.crm_public_message(text,text) from public,anon,authenticated;
grant execute on function public.crm_public_message(text,text) to anon,authenticated;

alter publication supabase_realtime add table public.crm_conversations;
alter publication supabase_realtime add table public.crm_messages;
alter publication supabase_realtime add table public.crm_webhook_events;
