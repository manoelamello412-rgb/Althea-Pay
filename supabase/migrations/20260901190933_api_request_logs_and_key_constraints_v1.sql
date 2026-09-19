create table if not exists public.api_request_logs (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, api_key_id uuid references public.api_keys(id) on delete set null, request_id text not null, method text not null, path text not null, status_code integer, latency_ms integer, scope text, ip_hash text, user_agent text, error_code text, created_at timestamptz not null default now());
alter table public.api_request_logs enable row level security;
create index if not exists api_request_logs_user_created_idx on public.api_request_logs(user_id, created_at desc);
create index if not exists api_request_logs_key_created_idx on public.api_request_logs(api_key_id, created_at desc);
create unique index if not exists api_keys_user_prefix_unique on public.api_keys(user_id, key_prefix);
create index if not exists api_keys_user_active_idx on public.api_keys(user_id, revoked_at, expires_at);