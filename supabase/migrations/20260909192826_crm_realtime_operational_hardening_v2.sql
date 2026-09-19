create table if not exists public.crm_webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text,
  transaction_id text,
  status text not null,
  error_reason text,
  buyer_email text,
  buyer_name text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.crm_conversations add column if not exists funnel_id text;
alter table public.crm_conversations add column if not exists product_id text;
alter table public.crm_conversations add column if not exists assigned_to uuid;
alter table public.crm_conversations add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_conversations add column if not exists public_token text;
alter table public.crm_conversations add column if not exists last_message_at timestamptz;
alter table public.crm_conversations add column if not exists last_message_direction text;
alter table public.crm_conversations add column if not exists unread_count integer not null default 0;

alter table public.crm_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_messages add column if not exists sender_id uuid;
alter table public.crm_messages add column if not exists sender_name text;
alter table public.crm_messages add column if not exists delivered_at timestamptz;

create unique index if not exists uq_crm_webhook_events_user_idempotency on public.crm_webhook_events(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_crm_webhook_events_user_received on public.crm_webhook_events(user_id,received_at desc);
create index if not exists idx_crm_webhook_events_transaction on public.crm_webhook_events(user_id,transaction_id);
create index if not exists idx_crm_conversations_user_updated on public.crm_conversations(user_id,updated_at desc);
create index if not exists idx_crm_conversations_user_email on public.crm_conversations(user_id,buyer_email);
create index if not exists idx_crm_conversations_funnel on public.crm_conversations(user_id,funnel_id);
create index if not exists idx_crm_messages_conversation_created on public.crm_messages(conversation_id,created_at);
create unique index if not exists uq_crm_conversations_public_token on public.crm_conversations(public_token) where public_token is not null;

alter table public.crm_webhook_events enable row level security;
drop policy if exists crm_webhook_events_select on public.crm_webhook_events;
create policy crm_webhook_events_select on public.crm_webhook_events for select to authenticated using (user_id = auth.uid());
grant select on public.crm_webhook_events to authenticated;

create or replace function public.crm_touch_conversation_from_message()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.crm_conversations
     set updated_at = timezone('utc', now()),
         last_message_at = new.created_at,
         last_message_direction = new.direction,
         unread_count = case when new.direction = 'inbound' then unread_count + 1 else 0 end
   where id = new.conversation_id and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists trg_crm_message_touch_conversation on public.crm_messages;
create trigger trg_crm_message_touch_conversation after insert on public.crm_messages for each row execute function public.crm_touch_conversation_from_message();

create or replace function public.crm_sync_webhook_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_funnel_id text := coalesce(new.payload->>'funnel_id',new.payload->>'funnelId');
  v_product_id text := coalesce(new.payload->>'product_id',new.payload->>'productId');
  v_conversation_id uuid;
  v_token text;
begin
  if new.transaction_id is null and new.buyer_email is null then return new; end if;
  select id into v_conversation_id from public.crm_conversations
   where user_id = new.user_id
     and ((new.transaction_id is not null and transaction_id = new.transaction_id) or (new.buyer_email is not null and lower(buyer_email)=lower(new.buyer_email)))
   order by updated_at desc limit 1;
  if v_conversation_id is null then
    v_token := encode(gen_random_bytes(24),'hex');
    insert into public.crm_conversations(user_id,buyer_email,buyer_name,transaction_id,funnel_id,product_id,status,metadata,public_token,last_message_at)
    values(new.user_id,new.buyer_email,new.buyer_name,new.transaction_id,v_funnel_id,v_product_id,'open',jsonb_build_object('created_from','webhook','webhook_event_id',new.id),v_token,new.received_at)
    returning id into v_conversation_id;
  else
    update public.crm_conversations set buyer_email=coalesce(new.buyer_email,buyer_email),buyer_name=coalesce(new.buyer_name,buyer_name),transaction_id=coalesce(new.transaction_id,transaction_id),funnel_id=coalesce(v_funnel_id,funnel_id),product_id=coalesce(v_product_id,product_id),updated_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('last_webhook_event_id',new.id) where id=v_conversation_id;
  end if;
  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at)
  values(v_conversation_id,new.user_id,'system','event',concat('Evento recebido: ',new.status,case when new.error_reason is not null then concat(' — ',new.error_reason) else '' end),jsonb_build_object('webhook_event_id',new.id,'transaction_id',new.transaction_id,'status',new.status),new.received_at);
  new.processed_at:=timezone('utc',now()); return new;
end;
$$;

drop trigger if exists trg_crm_sync_webhook_event on public.crm_webhook_events;
create trigger trg_crm_sync_webhook_event after insert on public.crm_webhook_events for each row execute function public.crm_sync_webhook_event();

alter publication supabase_realtime add table public.crm_webhook_events;