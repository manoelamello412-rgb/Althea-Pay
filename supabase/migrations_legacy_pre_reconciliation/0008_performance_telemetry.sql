-- ALTHEA PAY — performance telemetry realtime stream
-- Exposes only the existing per-operator routing logs to Supabase Realtime.
-- RLS remains authoritative for tenant isolation.

alter table public.transaction_routing_logs replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transaction_routing_logs'
  ) then
    alter publication supabase_realtime add table public.transaction_routing_logs;
  end if;
end $$;

create index if not exists transaction_routing_logs_user_created_idx
  on public.transaction_routing_logs(user_id, created_at desc);
