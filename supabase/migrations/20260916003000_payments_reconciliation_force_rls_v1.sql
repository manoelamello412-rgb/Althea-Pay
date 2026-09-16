-- Financial reconciliation records must remain protected even from table owners.
alter table public.reconciliation_items force row level security;
