create table if not exists public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_reference text,
  amount numeric(14,2) not null,
  currency text not null default 'BRL',
  risk_score numeric(5,2),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  decision text not null check (decision in ('allow','review','blocked')),
  provider text not null,
  reason_codes jsonb not null default '[]'::jsonb,
  signals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists risk_assessments_user_created_idx on public.risk_assessments(user_id,created_at desc);
alter table public.risk_assessments enable row level security;
drop policy if exists risk_assessments_select_own on public.risk_assessments;
create policy risk_assessments_select_own on public.risk_assessments for select to authenticated using (user_id=auth.uid());
revoke insert,update,delete on public.risk_assessments from authenticated;

create table if not exists public.outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  endpoint_url text not null,
  secret_ref text,
  secret_hash text,
  events text[] not null default array['order.approved']::text[],
  status text not null default 'active' check(status in ('active','paused','disabled')),
  max_attempts int not null default 8 check(max_attempts between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outbound_webhooks_user_status_idx on public.outbound_webhooks(user_id,status);
alter table public.outbound_webhooks enable row level security;
drop policy if exists outbound_webhooks_select_own on public.outbound_webhooks;
drop policy if exists outbound_webhooks_insert_own on public.outbound_webhooks;
drop policy if exists outbound_webhooks_update_own on public.outbound_webhooks;
drop policy if exists outbound_webhooks_delete_own on public.outbound_webhooks;
create policy outbound_webhooks_select_own on public.outbound_webhooks for select to authenticated using(user_id=auth.uid());
create policy outbound_webhooks_insert_own on public.outbound_webhooks for insert to authenticated with check(user_id=auth.uid());
create policy outbound_webhooks_update_own on public.outbound_webhooks for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy outbound_webhooks_delete_own on public.outbound_webhooks for delete to authenticated using(user_id=auth.uid());

create table if not exists public.outbound_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.outbound_webhooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid,
  event_type text not null,
  idempotency_key text not null,
  status text not null default 'pending' check(status in ('pending','delivered','retry','failed')),
  attempt int not null default 0,
  response_code int,
  response_time_ms int,
  error_message text,
  payload jsonb not null,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists outbound_webhook_delivery_dedupe_idx on public.outbound_webhook_deliveries(webhook_id,idempotency_key);
create index if not exists outbound_webhook_deliveries_retry_idx on public.outbound_webhook_deliveries(status,next_retry_at);
alter table public.outbound_webhook_deliveries enable row level security;
create policy outbound_webhook_deliveries_select_own on public.outbound_webhook_deliveries for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.outbound_webhook_deliveries from authenticated;
