create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_id uuid references public.integration_events(id) on delete set null,
  execution_key text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  action_type text,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(user_id, execution_key)
);
create index if not exists automation_executions_user_created_idx on public.automation_executions(user_id, created_at desc);
create index if not exists automation_executions_rule_created_idx on public.automation_executions(rule_id, created_at desc);
create index if not exists automation_executions_event_idx on public.automation_executions(event_id);
alter table public.automation_executions enable row level security;
drop policy if exists automation_executions_select_own on public.automation_executions;
create policy automation_executions_select_own on public.automation_executions for select to authenticated using (user_id = auth.uid());
revoke all on public.automation_executions from anon;
revoke all on public.automation_executions from authenticated;
