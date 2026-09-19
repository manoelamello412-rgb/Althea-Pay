-- "usuarios" was a demo table created outside the real schema; the platform already
-- has public.profiles (linked to auth.users) serving this purpose. Safe to drop: 0 rows.
drop table if exists public.usuarios;

-- core_job_queue has user_id but no policy yet (RLS enabled, correctly fail-closed).
-- Add owner-scoped read access so the dashboard can show job status directly.
create policy "owner_select" on public.core_job_queue
  for select
  using ((select auth.uid()) = user_id);
