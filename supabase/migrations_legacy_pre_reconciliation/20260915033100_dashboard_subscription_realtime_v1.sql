do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='subscriptions') then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='subscription_events') then
    alter publication supabase_realtime add table public.subscription_events;
  end if;
end $$;
