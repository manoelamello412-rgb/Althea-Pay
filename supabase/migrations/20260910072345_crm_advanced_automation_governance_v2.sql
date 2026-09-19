create or replace function public.crm_mark_automation_dead_letter(p_execution_id uuid,p_error text)
returns public.automation_executions
language plpgsql security definer set search_path=public
as $$
declare r public.automation_executions;
begin
 update public.automation_executions set status='dead_letter',dead_lettered_at=coalesce(dead_lettered_at,now()),next_retry_at=null,scheduled_at=null,error_message=left(coalesce(p_error,'unknown'),4000),completed_at=coalesce(completed_at,now()),updated_at=now()
 where id=p_execution_id and status in ('failed','running')
 returning * into r;
 return r;
end;
$$;
revoke all on function public.crm_mark_automation_dead_letter(uuid,text) from public;
grant execute on function public.crm_mark_automation_dead_letter(uuid,text) to service_role;
create or replace function public.crm_replay_automation_execution(p_execution_id uuid,p_reason text default null)
returns public.automation_executions
language plpgsql security definer set search_path=public
as $$
declare r public.automation_executions;
begin
 select * into r from public.automation_executions where id=p_execution_id and user_id=auth.uid() for update;
 if not found then raise exception 'automation_execution_not_found'; end if;
 if r.status <> 'dead_letter' then raise exception 'automation_execution_not_dead_letter'; end if;
 update public.automation_executions set status='scheduled',dead_lettered_at=null,error_message=null,next_retry_at=null,scheduled_at=now(),replayed_at=now(),replay_count=coalesce(replay_count,0)+1,cancellation_reason=left(coalesce(p_reason,'manual replay'),1000),updated_at=now() where id=p_execution_id returning * into r;
 return r;
end;
$$;
revoke all on function public.crm_replay_automation_execution(uuid,text) from public;
grant execute on function public.crm_replay_automation_execution(uuid,text) to authenticated;