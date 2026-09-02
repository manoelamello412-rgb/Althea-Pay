create or replace function public.recover_stale_core_jobs(p_stale_after interval default interval '10 minutes')
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  update public.core_job_queue
  set status='pending', available_at=now(), locked_at=null, locked_by=null,
      last_error=left(coalesce(last_error,'worker_lock_expired') || ' | worker_lock_expired',2000), updated_at=now()
  where status='processing'
    and locked_at is not null
    and locked_at < now() - p_stale_after
    and attempts < max_attempts;
  get diagnostics v_count = row_count;

  update public.core_job_queue
  set status='dead', locked_at=null, locked_by=null,
      last_error=left(coalesce(last_error,'worker_lock_expired') || ' | max_attempts_reached',2000), updated_at=now()
  where status='processing'
    and locked_at is not null
    and locked_at < now() - p_stale_after
    and attempts >= max_attempts;
  return v_count;
end;
$$;

revoke all on function public.recover_stale_core_jobs(interval) from public, anon, authenticated;
grant execute on function public.recover_stale_core_jobs(interval) to service_role;
