drop policy if exists automation_attempts_select_own on public.automation_execution_attempts;
drop policy if exists automation_execution_attempts_owner on public.automation_execution_attempts;
create policy automation_execution_attempts_owner on public.automation_execution_attempts for select to authenticated using (user_id=(select auth.uid()));
create index if not exists automation_attempts_execution_idx on public.automation_execution_attempts(execution_id,attempt_no desc);
