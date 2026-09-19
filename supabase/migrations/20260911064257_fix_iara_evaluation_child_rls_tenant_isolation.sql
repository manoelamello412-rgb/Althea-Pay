drop policy if exists iara_assertions_select_own on public.iara_evaluation_assertions;
create policy iara_assertions_select_own on public.iara_evaluation_assertions for select to authenticated using (exists (select 1 from public.iara_evaluations ev where ev.evaluation_id = iara_evaluation_assertions.evaluation_id and ev.tenant_id = (select auth.uid())));

drop policy if exists iara_claims_select_own on public.iara_evaluation_claims;
create policy iara_claims_select_own on public.iara_evaluation_claims for select to authenticated using (exists (select 1 from public.iara_evaluations ev where ev.evaluation_id = iara_evaluation_claims.evaluation_id and ev.tenant_id = (select auth.uid())));

drop policy if exists iara_failures_select_own on public.iara_evaluation_failures;
create policy iara_failures_select_own on public.iara_evaluation_failures for select to authenticated using (exists (select 1 from public.iara_evaluations ev where ev.evaluation_id = iara_evaluation_failures.evaluation_id and ev.tenant_id = (select auth.uid())));

drop policy if exists iara_tool_calls_select_own on public.iara_evaluation_tool_calls;
create policy iara_tool_calls_select_own on public.iara_evaluation_tool_calls for select to authenticated using (exists (select 1 from public.iara_evaluations ev where ev.evaluation_id = iara_evaluation_tool_calls.evaluation_id and ev.tenant_id = (select auth.uid())));