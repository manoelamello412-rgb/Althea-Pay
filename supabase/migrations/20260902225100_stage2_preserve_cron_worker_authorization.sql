CREATE OR REPLACE FUNCTION public.mark_abandoned_checkouts(p_after_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
declare n integer;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres','supabase_admin') then raise exception 'forbidden'; end if;
  update public.checkout_sessions
  set status='abandoned', abandoned_at=coalesce(abandoned_at,now()), recovery_status=coalesce(nullif(recovery_status,''),'pending')
  where status in ('started','pending','processing') and updated_at < now()-make_interval(mins=>greatest(1,p_after_minutes)) and completed_at is null;
  get diagnostics n=row_count;
  return n;
end $$;
REVOKE EXECUTE ON FUNCTION public.mark_abandoned_checkouts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_checkouts(integer) TO service_role;