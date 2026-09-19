create table if not exists public.api_rate_limit_buckets (api_key_id uuid primary key references public.api_keys(id) on delete cascade, window_started_at timestamptz not null default date_trunc('minute',now()), request_count integer not null default 0, updated_at timestamptz not null default now());
alter table public.api_rate_limit_buckets enable row level security;
revoke all on public.api_rate_limit_buckets from anon,authenticated;
create or replace function public.consume_althea_api_rate_limit(p_api_key_id uuid,p_limit integer default 120)
returns table(allowed boolean,remaining integer,reset_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare v_window timestamptz:=date_trunc('minute',now()); v_count integer; v_limit integer:=greatest(1,least(p_limit,10000));
begin
 insert into public.api_rate_limit_buckets(api_key_id,window_started_at,request_count,updated_at) values(p_api_key_id,v_window,1,now())
 on conflict(api_key_id) do update set window_started_at=case when api_rate_limit_buckets.window_started_at < v_window then v_window else api_rate_limit_buckets.window_started_at end, request_count=case when api_rate_limit_buckets.window_started_at < v_window then 1 else api_rate_limit_buckets.request_count+1 end, updated_at=now();
 select request_count into v_count from public.api_rate_limit_buckets where api_key_id=p_api_key_id;
 return query select v_count<=v_limit,greatest(0,v_limit-v_count),v_window+interval '1 minute';
end; $$;
revoke all on function public.consume_althea_api_rate_limit(uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_althea_api_rate_limit(uuid,integer) to service_role;