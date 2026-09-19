create or replace function public.crm_automation_attempt_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare n integer:=greatest(coalesce(new.attempt_count,1),1); terminal boolean:=new.status in ('completed','failed','dead_letter');
begin
 if tg_op='INSERT' then
  insert into public.automation_execution_attempts(user_id,execution_id,attempt_no,status,error_message,started_at,finished_at) values(new.user_id,new.id,n,new.status,new.error_message,coalesce(new.started_at,now()),case when terminal then coalesce(new.completed_at,now()) else null end) on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
  return new;
 end if;
 if new.attempt_count is distinct from old.attempt_count and new.attempt_count>old.attempt_count then
  insert into public.automation_execution_attempts(user_id,execution_id,attempt_no,status,error_message,started_at,finished_at) values(new.user_id,new.id,n,new.status,new.error_message,coalesce(new.started_at,now()),case when terminal then coalesce(new.completed_at,now()) else null end) on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
 else
  update public.automation_execution_attempts set status=new.status,error_message=new.error_message,finished_at=case when terminal then coalesce(new.completed_at,now()) else finished_at end where execution_id=new.id and attempt_no=n;
 end if;
 return new;
end $$;
revoke all on function public.crm_automation_attempt_audit() from public,anon,authenticated;
grant execute on function public.crm_automation_attempt_audit() to service_role;