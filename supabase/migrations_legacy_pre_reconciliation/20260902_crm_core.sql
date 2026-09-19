create table if not exists public.crm_webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text,
  status varchar(40) not null,
  error_reason varchar(120),
  buyer_email varchar(320),
  buyer_name varchar(255),
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists idx_crm_webhook_events_user_received on public.crm_webhook_events(user_id, received_at desc);

create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_email varchar(320),
  buyer_name varchar(255),
  transaction_id text,
  status varchar(30) not null default 'open' check (status in ('open','pending','closed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction varchar(20) not null check (direction in ('inbound','outbound','system')),
  channel varchar(30) not null default 'internal',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.crm_trigger_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(160) not null,
  enabled boolean not null default true,
  event_type varchar(80) not null default 'transaction.failed',
  conditions jsonb not null default '{}'::jsonb,
  action_type varchar(80) not null default 'automated_whatsapp_dispatch',
  action_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.crm_webhook_events enable row level security;
alter table public.crm_conversations enable row level security;
alter table public.crm_messages enable row level security;
alter table public.crm_trigger_rules enable row level security;

create policy crm_webhook_events_select on public.crm_webhook_events for select to authenticated using (user_id = auth.uid());
create policy crm_conversations_all on public.crm_conversations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy crm_messages_select on public.crm_messages for select to authenticated using (user_id = auth.uid());
create policy crm_messages_insert on public.crm_messages for insert to authenticated with check (user_id = auth.uid());
create policy crm_trigger_rules_all on public.crm_trigger_rules for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.crm_webhook_events to authenticated;
grant select, insert, update, delete on public.crm_conversations to authenticated;
grant select, insert on public.crm_messages to authenticated;
grant select, insert, update, delete on public.crm_trigger_rules to authenticated;

create or replace function public.touch_crm_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_crm_conversations_updated_at on public.crm_conversations;
create trigger trg_crm_conversations_updated_at before update on public.crm_conversations for each row execute function public.touch_crm_updated_at();
drop trigger if exists trg_crm_trigger_rules_updated_at on public.crm_trigger_rules;
create trigger trg_crm_trigger_rules_updated_at before update on public.crm_trigger_rules for each row execute function public.touch_crm_updated_at();
