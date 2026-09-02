-- ALTHEA CORE: retry / DLQ / reconciliation primitives
-- Additive migration. Real gateway integrations remain external to this layer.

create table if not exists public.core_job_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists core_job_queue_ready_idx
  on public.core_job_queue (status, available_at, created_at)
  where status = 'pending';

create index if not exists core_job_queue_aggregate_idx
  on public.core_job_queue (aggregate_type, aggregate_id, created_at desc);

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'financial',
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  scanned_count integer not null default 0,
  mismatch_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  code text not null,
  expected jsonb,
  actual jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reconciliation_items_run_idx on public.reconciliation_items(run_id, status);
create index if not exists reconciliation_items_user_idx on public.reconciliation_items(user_id, created_at desc);

alter table public.core_job_queue enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;

create or replace function public.enqueue_core_job(
  p_user_id uuid,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb,
  p_aggregate_type text default null,
  p_aggregate_id uuid default null,
  p_available_at timestamptz default now(),
  p_max_attempts integer default 8
) returns public.core_job_queue
language plpgsql security definer set search_path=public as $$
declare v public.core_job_queue;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.core_job_queue(user_id,job_type,aggregate_type,aggregate_id,payload,available_at,max_attempts)
  values(p_user_id,p_job_type,p_aggregate_type,p_aggregate_id,coalesce(p_payload,'{}'::jsonb),coalesce(p_available_at,now()),least(greatest(coalesce(p_max_attempts,8),1),50))
  returning * into v;
  return v;
end; $$;

create or replace function public.claim_core_jobs(p_worker_id text, p_limit integer default 20)
returns setof public.core_job_queue
language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with picked as (
    select id from public.core_job_queue
    where status='pending' and available_at <= now()
    order by created_at
    for update skip locked limit least(greatest(coalesce(p_limit,20),1),100)
  )
  update public.core_job_queue q
  set status='processing', attempts=q.attempts+1, locked_at=now(), locked_by=p_worker_id, updated_at=now()
  from picked where q.id=picked.id
  returning q.*;
end; $$;

create or replace function public.finish_core_job(p_job_id uuid, p_success boolean, p_error text default null)
returns public.core_job_queue
language plpgsql security definer set search_path=public as $$
declare v public.core_job_queue; v_delay interval;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select * into v from public.core_job_queue where id=p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if p_success then
    update public.core_job_queue set status='completed',completed_at=now(),locked_at=null,locked_by=null,last_error=null,updated_at=now() where id=id returning * into v;
  elsif v.attempts >= v.max_attempts then
    update public.core_job_queue set status='dead',locked_at=null,locked_by=null,last_error=left(coalesce(p_error,'job_failed'),2000),updated_at=now() where id=p_job_id returning * into v;
  else
    v_delay := make_interval(secs => least(3600, greatest(5, power(2, v.attempts)::integer * 5)));
    update public.core_job_queue set status='pending',available_at=now()+v_delay,locked_at=null,locked_by=null,last_error=left(coalesce(p_error,'job_failed'),2000),updated_at=now() where id=p_job_id returning * into v;
  end if;
  return v;
end; $$;

revoke all on function public.enqueue_core_job(uuid,text,jsonb,text,uuid,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.claim_core_jobs(text,integer) from public,anon,authenticated;
revoke all on function public.finish_core_job(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.enqueue_core_job(uuid,text,jsonb,text,uuid,timestamptz,integer) to service_role;
grant execute on function public.claim_core_jobs(text,integer) to service_role;
grant execute on function public.finish_core_job(uuid,boolean,text) to service_role;
