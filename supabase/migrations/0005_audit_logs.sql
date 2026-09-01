create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, actor_id uuid references auth.users(id) on delete set null, action text not null, resource_type text, resource_id text, request_id text, ip_hash text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
alter table public.audit_logs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_owner_read') then create policy audit_logs_owner_read on public.audit_logs for select to authenticated using (user_id=auth.uid()); end if;
end $$;
create index if not exists audit_logs_user_time_idx on public.audit_logs(user_id, created_at desc);
create index if not exists audit_logs_resource_idx on public.audit_logs(user_id, resource_type, resource_id, created_at desc);
comment on table public.audit_logs is 'Security/audit trail. Do not store secrets, PAN, CVC or raw authorization headers.';
