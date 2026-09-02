-- Althea Pay production synchronization marker.
-- This migration intentionally makes no schema changes.
-- It establishes a shared GitHub/Supabase synchronization point after
-- reconciling the production Edge Function with the GitHub source.
DO $$
BEGIN
  RAISE NOTICE 'Althea Pay GitHub/Supabase sync marker applied';
END $$;
