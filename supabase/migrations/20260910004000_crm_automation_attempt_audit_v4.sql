create or replace function public.crm_automation_attempt_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare n integer; terminal boolean;
begin
 terminal := new.status in ('completed','failed','dead_letter');
 if tg_op='INSERT' then
   n:=greatest(coalesce(new.attempt_count,1),1);
   insert into public.automation_execution_attempts(user_id,execution_id,attempt_no,status,started_at,error_message,finished_at) values(new.user_id,new.id,n,new.status,coalesce(new.started_at,new.created_at,now()),new.error_message,case when terminal then coalesce(new.completed_at,now()) else null end) on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
 elsif new.attempt_count is distinct from old.attempt_count then
   n:=greatest(coalesce(new.attempt_count,1),1);
   insert into public.automation_execution_attempts(user_id,execution_id,attempt_no,status,started_at,error_message,finished_at) values(new.user_id,new.id,n,new.status,coalesce(new.started_at,now()),new.error_message,case when terminal then coalesce(new.completed_at,now()) else null end) on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
 elsif terminal then
   update public.automation_execution_attempts set status=new.status,error_message=new.error_message,finished_at=coalesce(new.completed_at,now()) where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1);
 end if;
 return new;
end $$;
drop trigger if exists trg_crm_automation_attempt_audit on public.automation_executions;
create trigger trg_crm_automation_attempt_audit after insert or update of status,error_message,completed_at,attempt_count on public.automation_executions for each row execute function public.crm_automation_attempt_audit();
revoke all on function public.crm_automation_attempt_audit() from public,anon,authenticated;
grant execute on function public.crm_automation_attempt_audit() to service_role;