create table if not exists public.crm_channel_message_outbox (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 conversation_id uuid references public.crm_conversations(id) on delete cascade,
 channel_account_id uuid references public.crm_channel_accounts(id) on delete set null,
 channel text not null check (channel in ('funnel_chat','whatsapp','instagram','messenger','email','sms')),
 external_message_id text,
 idempotency_key text not null,
 direction text not null default 'outbound' check (direction='outbound'),
 body text not null,
 status text not null default 'queued' check (status in ('queued','processing','sent','failed','dead_letter')),
 attempts integer not null default 0,
 max_attempts integer not null default 5,
 next_attempt_at timestamptz,
 sent_at timestamptz,
 failed_at timestamptz,
 last_error text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create index if not exists crm_channel_message_outbox_queue_idx on public.crm_channel_message_outbox(status,next_attempt_at,created_at);
create index if not exists crm_channel_message_outbox_conversation_idx on public.crm_channel_message_outbox(user_id,conversation_id,created_at desc);
alter table public.crm_channel_message_outbox enable row level security;
drop policy if exists crm_channel_message_outbox_owner on public.crm_channel_message_outbox;
create policy crm_channel_message_outbox_owner on public.crm_channel_message_outbox for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create or replace function public.crm_claim_channel_outbox(p_limit integer default 25)
returns setof public.crm_channel_message_outbox
language plpgsql security invoker set search_path=public
as $$
begin
 return query
 with claimed as (
  select id from public.crm_channel_message_outbox
  where user_id=auth.uid() and status='queued' and (next_attempt_at is null or next_attempt_at<=now())
  order by created_at
  for update skip locked limit greatest(1,least(p_limit,100))
 )
 update public.crm_channel_message_outbox o
 set status='processing', attempts=attempts+1, updated_at=now()
 from claimed c where o.id=c.id
 returning o.*;
end; $$;
revoke all on function public.crm_claim_channel_outbox(integer) from anon;
grant execute on function public.crm_claim_channel_outbox(integer) to authenticated;
