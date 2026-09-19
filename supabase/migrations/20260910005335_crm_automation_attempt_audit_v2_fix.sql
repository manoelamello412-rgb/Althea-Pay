create or replace function public.crm_audit_automation_attempt() returns trigger language plpgsql security definer set search_path=public as $fn$
declare a uuid;
begin
 if tg_op='INSERT' and new.status='running' then
  if not exists(select 1 from public.automation_execution_attempts where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1)) then
   insert into public.automation_execution_attempts(execution_id,user_id,attempt_no,status,started_at,created_at) values(new.id,new.user_id,greatest(coalesce(new.attempt_count,1),1),'running',coalesce(new.started_at,now()),now());
  end if;
 elsif tg_op='UPDATE' and old.status is distinct from new.status then
  if new.status='running' then
   if not exists(select 1 from public.automation_execution_attempts where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1)) then
    insert into public.automation_execution_attempts(execution_id,user_id,attempt_no,status,started_at,created_at) values(new.id,new.user_id,greatest(coalesce(new.attempt_count,1),1),'running',coalesce(new.started_at,now()),now());
   end if;
  else
   select id into a from public.automation_execution_attempts where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1) order by created_at desc limit 1;
   if a is not null then update public.automation_execution_attempts set status=new.status,finished_at=case when new.status in ('completed','failed','dead_letter') then coalesce(new.completed_at,now()) else finished_at end,next_retry_at=new.next_retry_at,error_message=new.error_message,output=new.output where id=a; end if;
  end if;
 end if;
 return new;
end;
$fn$;
drop trigger if exists trg_crm_automation_attempt_audit on public.automation_executions;
create trigger trg_crm_automation_attempt_audit after insert or update of status,attempt_count,next_retry_at,error_message,output,completed_at on public.automation_executions for each row execute function public.crm_audit_automation_attempt();
revoke all on function public.crm_audit_automation_attempt() from public,anon,authenticated;
grant execute on function public.crm_audit_automation_attempt() to service_role;