create table if not exists public.automation_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.automation_executions(id) on delete cascade,
  user_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  status text not null check (status in ('running','completed','failed','retry_scheduled','dead_letter')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  next_retry_at timestamptz,
  error_message text,
  output jsonb,
  created_at timestamptz not null default now(),
  unique(execution_id, attempt_no)
);

alter table public.automation_executions
  add column if not exists max_attempts integer not null default 3,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists dead_lettered_at timestamptz;

create index if not exists automation_exec_retry_queue_idx
  on public.automation_executions(user_id, status, next_retry_at)
  where status in ('failed','retry_scheduled');

create index if not exists automation_attempts_execution_idx
  on public.automation_execution_attempts(execution_id, attempt_no desc);

alter table public.automation_execution_attempts enable row level security;
drop policy if exists automation_attempts_select_own on public.automation_execution_attempts;
create policy automation_attempts_select_own on public.automation_execution_attempts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists automation_attempts_insert_own on public.automation_execution_attempts;
create policy automation_attempts_insert_own on public.automation_execution_attempts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists automation_attempts_update_own on public.automation_execution_attempts;
create policy automation_attempts_update_own on public.automation_execution_attempts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
