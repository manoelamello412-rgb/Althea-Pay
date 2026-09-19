begin;

-- Views must execute with the caller's RLS context. The canonical commercial
-- read surface is tenant-scoped and must never bypass table policies.
alter view public.v_funnel_commercial_context
  set (security_invoker = true);

commit;
