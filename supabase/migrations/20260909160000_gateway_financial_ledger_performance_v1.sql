drop policy if exists gateway_financial_journals_select_own on public.gateway_financial_journals;
create policy gateway_financial_journals_select_own on public.gateway_financial_journals for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists gateway_financial_entries_select_own on public.gateway_financial_entries;
create policy gateway_financial_entries_select_own on public.gateway_financial_entries for select to authenticated using (user_id = (select auth.uid()));
create index if not exists gateway_financial_entries_journal_user_idx on public.gateway_financial_entries(journal_id,user_id);
create index if not exists gateway_financial_journals_gateway_fk_idx on public.gateway_financial_journals(gateway_id);
create index if not exists gateway_financial_journals_transaction_fk_idx on public.gateway_financial_journals(transaction_id);
