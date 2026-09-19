create schema if not exists private;
create table if not exists private.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete set null,
  user_id uuid not null,
  request_id text not null,
  method text not null,
  path text not null,
  status_code integer not null,
  ip inet,
  user_agent text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists api_request_logs_key_created_idx on private.api_request_logs(api_key_id, created_at desc);
create index if not exists api_request_logs_user_created_idx on private.api_request_logs(user_id, created_at desc);
create index if not exists api_request_logs_request_id_idx on private.api_request_logs(request_id);
create table if not exists private.api_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create or replace function public.check_althea_api_rate_limit(p_key_id uuid, p_limit integer default 120, p_window_seconds integer default 60)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bucket text := 'key:' || p_key_id::text;
  v_now timestamptz := now();
  v_count integer;
  v_started timestamptz;
begin
  insert into private.api_rate_limit_buckets(bucket_key, window_started_at, request_count, updated_at)
  values(v_bucket, v_now, 1, v_now)
  on conflict(bucket_key) do update
  set request_count = case when v_now - private.api_rate_limit_buckets.window_started_at >= make_interval(secs => p_window_seconds) then 1 else private.api_rate_limit_buckets.request_count + 1 end,
      window_started_at = case when v_now - private.api_rate_limit_buckets.window_started_at >= make_interval(secs => p_window_seconds) then v_now else private.api_rate_limit_buckets.window_started_at end,
      updated_at = v_now
  returning request_count, window_started_at into v_count, v_started;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_althea_api_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.check_althea_api_rate_limit(uuid, integer, integer) to service_role;