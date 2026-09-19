alter table public.automation_executions drop constraint if exists automation_executions_status_check;
alter table public.automation_executions add constraint automation_executions_status_check check (status = any (array['pending','scheduled','running','completed','failed','skipped','dead_letter','cancelled']::text[]));
alter table public.automation_executions add column if not exists scheduled_at timestamptz;
alter table public.automation_executions add column if not exists cancelled_at timestamptz;
alter table public.automation_executions add column if not exists cancellation_reason text;
alter table public.automation_executions add column if not exists replayed_at timestamptz;
alter table public.automation_executions add column if not exists replay_count integer not null default 0;
create index if not exists automation_executions_scheduled_idx on public.automation_executions(user_id, scheduled_at, created_at) where status='scheduled' and scheduled_at is not null;
create index if not exists automation_execution_attempts_rate_limit_idx on public.automation_execution_attempts(user_id, execution_id, started_at);
create or replace function public.crm_claim_scheduled_automation_executions(p_limit integer default 25)
returns setof public.automation_executions
language plpgsql security definer set search_path=public
as $$
begin
  return query
  with candidates as (
    select id from public.automation_executions
    where status='scheduled' and scheduled_at is not null and scheduled_at <= now() and cancelled_at is null
    order by scheduled_at, created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.automation_executions e
  set status='running', attempt_count=e.attempt_count+1, started_at=now(), scheduled_at=null, updated_at=now()
  from candidates c where e.id=c.id returning e.*;
end;
$$;
revoke all on function public.crm_claim_scheduled_automation_executions(integer) from public;
grant execute on function public.crm_claim_scheduled_automation_executions(integer) to service_role;
create or replace function public.crm_cancel_automation_execution(p_execution_id uuid,p_reason text default null)
returns public.automation_executions
language plpgsql security definer set search_path=public
as $$
declare r public.automation_executions;
begin
  update public.automation_executions set status='cancelled',cancelled_at=now(),cancellation_reason=left(coalesce(p_reason,'manual cancellation'),1000),next_retry_at=null,scheduled_at=null,updated_at=now()
  where id=p_execution_id and status in ('pending','scheduled','failed') and dead_lettered_at is null
  returning * into r;
  return r;
end;
$$;
revoke all on function public.crm_cancel_automation_execution(uuid,text) from public;
grant execute on function public.crm_cancel_automation_execution(uuid,text) to authenticated;
create or replace function public.crm_replay_automation_execution(p_execution_id uuid,p_reason text default null)
returns public.automation_executions
language plpgsql security definer set search_path=public
as $$
declare r public.automation_executions;
begin
  select * into r from public.automation_executions where id=p_execution_id and user_id=auth.uid() for update;
  if not found then raise exception 'automation_execution_not_found'; end if;
  if r.status <> 'dead_letter' then raise exception 'automation_execution_not_dead_letter'; end if;
  update public.automation_executions set status='pending',dead_lettered_at=null,error_message=null,next_retry_at=null,scheduled_at=now(),replayed_at=now(),replay_count=coalesce(replay_count,0)+1,cancellation_reason=null,updated_at=now() where id=p_execution_id returning * into r;
  return r;
end;
$$;
revoke all on function public.crm_replay_automation_execution(uuid,text) from public;
grant execute on function public.crm_replay_automation_execution(uuid,text) to authenticated;
create or replace function public.crm_check_automation_rate_limit(p_user_id uuid,p_rule_id uuid,p_limit integer default 60,p_window_seconds integer default 60)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('automation-rate:'||p_user_id::text||':'||p_rule_id::text));
  select count(*) into v_count from public.automation_execution_attempts a join public.automation_executions e on e.id=a.execution_id where e.user_id=p_user_id and e.rule_id=p_rule_id and a.started_at >= now()-make_interval(secs=>least(p_window_seconds,86400));
  return v_count < least(p_limit,10000);
end;
$$;
revoke all on function public.crm_check_automation_rate_limit(uuid,uuid,integer,integer) from public;
grant execute on function public.crm_check_automation_rate_limit(uuid,uuid,integer,integer) to service_role;
create or replace function public.crm_claim_automation_retries(p_limit integer default 25)
returns setof public.automation_executions
language plpgsql security definer set search_path=public
as $$
begin
  return query
  with candidates as (
    select id from public.automation_executions
    where status='failed' and dead_lettered_at is null and next_retry_at is not null and next_retry_at <= now() and attempt_count < greatest(1,max_attempts)
    order by next_retry_at, created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.automation_executions e set status='running',attempt_count=e.attempt_count+1,started_at=now(),error_message=null,next_retry_at=null,updated_at=now() from candidates c where e.id=c.id returning e.*;
end;
$$;