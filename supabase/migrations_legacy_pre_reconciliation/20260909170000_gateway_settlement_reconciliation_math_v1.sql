alter table public.settlements drop constraint if exists settlements_totals_ck;
alter table public.settlements add constraint settlements_totals_ck check (gross_total >= 0 and fees_total >= 0 and net_total >= 0 and discrepancy_amount is not null and abs(net_total - (gross_total-fees_total)) <= 0.01);
alter table public.reconciliation_runs drop constraint if exists reconciliation_runs_totals_ck;
alter table public.reconciliation_runs add constraint reconciliation_runs_totals_ck check (gross_expected >= 0 and gross_reported >= 0 and fees_expected >= 0 and fees_reported >= 0 and net_expected >= 0 and net_reported >= 0 and abs(net_expected-(gross_expected-fees_expected)) <= 0.01 and abs(net_reported-(gross_reported-fees_reported)) <= 0.01);
