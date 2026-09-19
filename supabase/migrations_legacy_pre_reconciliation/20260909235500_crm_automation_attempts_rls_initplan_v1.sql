drop policy if exists automation_attempts_insert_own on public.automation_execution_attempts;
create policy automation_attempts_insert_own on public.automation_execution_attempts for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists automation_attempts_select_own on public.automation_execution_attempts;
create policy automation_attempts_select_own on public.automation_execution_attempts for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists automation_attempts_update_own on public.automation_execution_attempts;
create policy automation_attempts_update_own on public.automation_execution_attempts for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));