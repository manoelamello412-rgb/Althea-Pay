create or replace function public.crm_claim_automation_retries(p_limit integer default 25)
returns setof public.automation_executions
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select id
    from public.automation_executions
    where status='failed'
      and dead_lettered_at is null
      and next_retry_at is not null
      and next_retry_at <= now()
      and attempt_count < greatest(1,max_attempts)
    order by next_retry_at, created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.automation_executions e
  set status='running', attempt_count=e.attempt_count+1, started_at=now(),
      error_message=null, next_retry_at=null, updated_at=now()
  from candidates c where e.id=c.id
  returning e.*;
end;
$$;
revoke all on function public.crm_claim_automation_retries(integer) from public,anon,authenticated;
grant execute on function public.crm_claim_automation_retries(integer) to service_role;

create or replace function public.crm_mark_automation_dead_letter(p_execution_id uuid,p_error text)
returns public.automation_executions
language plpgsql
security definer
set search_path=public
as $$
declare r public.automation_executions;
begin
 update public.automation_executions
 set status='dead_letter', dead_lettered_at=now(), next_retry_at=null,
     error_message=left(coalesce(p_error,'unknown'),4000), completed_at=now(), updated_at=now()
 where id=p_execution_id returning * into r;
 return r;
end;
$$;
revoke all on function public.crm_mark_automation_dead_letter(uuid,text) from public,anon,authenticated;
grant execute on function public.crm_mark_automation_dead_letter(uuid,text) to service_role;

create index if not exists automation_executions_retry_queue_v2
on public.automation_executions(status,next_retry_at,attempt_count,created_at)
where status='failed' and dead_lettered_at is null and next_retry_at is not null;
