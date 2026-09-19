revoke execute on function public.broadcast_funnel_health() from anon, authenticated;
revoke execute on function public.broadcast_integration_event() from anon, authenticated;
revoke execute on function public.ensure_funnel_connection() from anon, authenticated;
revoke execute on function public.get_funnel_connection_health(uuid) from authenticated;
revoke execute on function public.register_integration_event(text,text,text,jsonb,timestamptz) from authenticated;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.api_keys enable row level security;
create policy api_keys_select_own on public.api_keys for select to authenticated using (user_id = auth.uid());
create policy api_keys_insert_own on public.api_keys for insert to authenticated with check (user_id = auth.uid());
create policy api_keys_update_own on public.api_keys for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.funnel_trash (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  funnel_id text not null,
  funnel_snapshot jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
alter table public.funnel_trash enable row level security;
create policy funnel_trash_select_own on public.funnel_trash for select to authenticated using (user_id = auth.uid());
create policy funnel_trash_insert_own on public.funnel_trash for insert to authenticated with check (user_id = auth.uid());
create policy funnel_trash_update_own on public.funnel_trash for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_api_keys_user_active on public.api_keys(user_id, revoked_at, expires_at);
create index if not exists idx_funnel_trash_user_deleted on public.funnel_trash(user_id, deleted_at desc);
create index if not exists idx_gateway_transactions_user_status_created on public.gateway_transactions(user_id, status, created_at desc);
create index if not exists idx_checkout_sessions_user_status_created on public.checkout_sessions(user_id, status, created_at desc);
create index if not exists idx_integration_events_user_status_created on public.integration_events(user_id, status, created_at desc);

alter table public.gateway_transactions add column if not exists attempt_count integer not null default 0;
alter table public.gateway_transactions add column if not exists completed_at timestamptz;
alter table public.gateway_transactions add column if not exists failure_code text;
alter table public.gateway_transactions add column if not exists routing_metadata jsonb not null default '{}'::jsonb;

alter table public.checkout_sessions add column if not exists abandoned_at timestamptz;
alter table public.checkout_sessions add column if not exists completed_at timestamptz;
alter table public.checkout_sessions add column if not exists recovery_count integer not null default 0;

create table if not exists public.recovery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_id uuid references public.checkout_sessions(id) on delete cascade,
  event_type text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.recovery_events enable row level security;
create policy recovery_events_select_own on public.recovery_events for select to authenticated using (user_id = auth.uid());
create policy recovery_events_insert_own on public.recovery_events for insert to authenticated with check (user_id = auth.uid());
create policy recovery_events_update_own on public.recovery_events for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists idx_recovery_events_user_status on public.recovery_events(user_id,status,created_at desc);

create table if not exists public.team_funnel_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  funnel_id text not null references public.funnels(id) on delete cascade,
  access_level text not null default 'viewer' check(access_level in ('viewer','operator','supervisor','manager','admin','owner')),
  created_at timestamptz not null default now(),
  primary key(user_id,funnel_id)
);
alter table public.team_funnel_access enable row level security;
create policy team_funnel_access_select_own on public.team_funnel_access for select to authenticated using (user_id = auth.uid());
create policy team_funnel_access_insert_own on public.team_funnel_access for insert to authenticated with check (user_id = auth.uid());
create policy team_funnel_access_update_own on public.team_funnel_access for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy team_funnel_access_delete_own on public.team_funnel_access for delete to authenticated using (user_id = auth.uid());

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  integration_id uuid,
  event_type text not null,
  endpoint text,
  signature_valid boolean not null default false,
  status text not null default 'pending',
  attempt integer not null default 1,
  response_code integer,
  response_time_ms integer,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
alter table public.webhook_deliveries enable row level security;
create policy webhook_deliveries_select_own on public.webhook_deliveries for select to authenticated using (user_id = auth.uid());
create policy webhook_deliveries_insert_own on public.webhook_deliveries for insert to authenticated with check (user_id = auth.uid());
create policy webhook_deliveries_update_own on public.webhook_deliveries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists idx_webhook_deliveries_user_status on public.webhook_deliveries(user_id,status,created_at desc);
