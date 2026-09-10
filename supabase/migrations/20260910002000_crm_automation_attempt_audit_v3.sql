create table if not exists public.automation_execution_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null, execution_id uuid not null, attempt_no integer not null, status text not null, started_at timestamptz not null default now(), finished_at timestamptz, error_message text, created_at timestamptz not null default now(), unique(execution_id,attempt_no));
alter table public.automation_execution_attempts enable row level security;
drop policy if exists automation_execution_attempts_owner on public.automation_execution_attempts;
create policy automation_execution_attempts_owner on public.automation_execution_attempts for select to authenticated using (user_id=auth.uid());
create or replace function public.crm_automation_attempt_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 select coalesce(max(attempt_no),0)+1 into n from public.automation_execution_attempts where execution_id=new.id;
 insert into public.automation_execution_attempts(user_id,execution_id,attempt_no,status,error_message,finished_at) values(new.user_id,new.id,n,new.status,new.error_message,case when new.status in ('completed','failed','dead_letter') then coalesce(new.completed_at,now()) else null end) on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
 return new;
end $$;
drop trigger if exists trg_crm_automation_attempt_audit on public.automation_executions;
create trigger trg_crm_automation_attempt_audit after insert or update of status,error_message,completed_at on public.automation_executions for each row execute function public.crm_automation_attempt_audit();
revoke all on function public.crm_automation_attempt_audit() from public,anon,authenticated;
grant execute on function public.crm_automation_attempt_audit() to service_role;