begin;

alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_runs force row level security;
alter table public.reconciliation_items enable row level security;
alter table public.reconciliation_items force row level security;

revoke all on table public.reconciliation_runs from anon,authenticated;
revoke all on table public.reconciliation_items from anon,authenticated;

commit;
