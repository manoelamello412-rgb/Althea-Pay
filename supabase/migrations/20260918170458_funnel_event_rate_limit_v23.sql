create table if not exists private.funnel_event_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table private.funnel_event_rate_limit_buckets enable row level security;

create or replace function public.consume_funnel_event_rate_limit(
  p_bucket_key text,
  p_limit integer default 600,
  p_window_seconds integer default 60
) returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_window interval:=make_interval(secs=>greatest(10,least(coalesce(p_window_seconds,60),3600)));
  v_limit integer:=greatest(10,least(coalesce(p_limit,600),10000));
  v_count integer;
  v_start timestamptz;
begin
  if p_bucket_key is null or length(trim(p_bucket_key))=0 or length(p_bucket_key)>300 then
    raise exception using errcode='22023',message='invalid_rate_limit_bucket';
  end if;

  insert into private.funnel_event_rate_limit_buckets(bucket_key,window_started_at,request_count,updated_at)
  values(p_bucket_key,v_now,1,v_now)
  on conflict(bucket_key) do update set
    window_started_at=case
      when private.funnel_event_rate_limit_buckets.window_started_at <= v_now-v_window then v_now
      else private.funnel_event_rate_limit_buckets.window_started_at
    end,
    request_count=case
      when private.funnel_event_rate_limit_buckets.window_started_at <= v_now-v_window then 1
      else private.funnel_event_rate_limit_buckets.request_count+1
    end,
    updated_at=v_now
  returning request_count,window_started_at into v_count,v_start;

  allowed:=v_count<=v_limit;
  remaining:=greatest(0,v_limit-v_count);
  reset_at:=v_start+v_window;
  return next;
end;
$function$;

revoke all on function public.consume_funnel_event_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_funnel_event_rate_limit(text,integer,integer) to service_role;
