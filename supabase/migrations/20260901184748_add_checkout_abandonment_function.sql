create or replace function public.mark_abandoned_checkouts(p_user_id uuid, p_minutes integer default 30)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer;
begin
  update public.checkout_sessions
     set status = 'abandoned', abandoned_at = coalesce(abandoned_at, now()), updated_at = now()
   where user_id = p_user_id
     and status in ('pending','started')
     and updated_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_abandoned_checkouts(uuid, integer) from public, anon;
grant execute on function public.mark_abandoned_checkouts(uuid, integer) to authenticated;
