-- Fix advanced automation governance RPCs to match the physical automation_executions schema.
-- The table has no updated_at column; state transitions are timestamped by the existing lifecycle fields/triggers.

CREATE OR REPLACE FUNCTION public.crm_claim_automation_retries(p_limit integer DEFAULT 25)
RETURNS SETOF public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select id from public.automation_executions
    where status='failed' and dead_lettered_at is null and next_retry_at is not null and next_retry_at <= now() and attempt_count < greatest(1,max_attempts)
    order by next_retry_at, created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.automation_executions e
  set status='running', attempt_count=e.attempt_count+1, started_at=now(), error_message=null, next_retry_at=null
  from candidates c where e.id=c.id returning e.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_claim_scheduled_automation_executions(p_limit integer DEFAULT 25)
RETURNS SETOF public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select id from public.automation_executions
    where status='scheduled' and scheduled_at is not null and scheduled_at <= now() and cancelled_at is null
    order by scheduled_at, created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.automation_executions e
  set status='running', attempt_count=e.attempt_count+1, started_at=now(), scheduled_at=null
  from candidates c where e.id=c.id returning e.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_cancel_automation_execution(p_execution_id uuid, p_reason text DEFAULT NULL)
RETURNS public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r public.automation_executions;
begin
  update public.automation_executions
  set status='cancelled', cancelled_at=now(), cancellation_reason=left(coalesce(p_reason,'manual cancellation'),1000), next_retry_at=null, scheduled_at=null
  where id=p_execution_id and status in ('pending','scheduled','failed') and dead_lettered_at is null
  returning * into r;
  return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_mark_automation_dead_letter(p_execution_id uuid, p_error text)
RETURNS public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r public.automation_executions;
begin
 update public.automation_executions
 set status='dead_letter', dead_lettered_at=coalesce(dead_lettered_at,now()), next_retry_at=null, scheduled_at=null, error_message=left(coalesce(p_error,'unknown'),4000), completed_at=coalesce(completed_at,now())
 where id=p_execution_id and status in ('failed','running')
 returning * into r;
 return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_replay_automation_execution(p_execution_id uuid, p_reason text DEFAULT NULL)
RETURNS public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r public.automation_executions;
begin
 select * into r from public.automation_executions where id=p_execution_id and user_id=auth.uid() for update;
 if not found then raise exception 'automation_execution_not_found'; end if;
 if r.status <> 'dead_letter' then raise exception 'automation_execution_not_dead_letter'; end if;
 update public.automation_executions
 set status='scheduled', dead_lettered_at=null, error_message=null, next_retry_at=null, scheduled_at=now(), replayed_at=now(), replay_count=coalesce(replay_count,0)+1, cancellation_reason=left(coalesce(p_reason,'manual replay'),1000)
 where id=p_execution_id returning * into r;
 return r;
end;
$function$;
