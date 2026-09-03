-- Recovery boundary for jobs abandoned by crashed workers.
create or replace function public.recover_stale_core_jobs(p_stale_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  update public.core_job_queue
  set status = 'pending',
      locked_at = null,
      locked_by = null,
      available_at = least(available_at, now()),
      last_error = coalesce(last_error, 'worker_lock_timeout'),
      updated_at = now()
  where status = 'processing'
    and locked_at is not null
    and locked_at < now() - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 10)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recover_stale_core_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_core_jobs(integer) to service_role;

create or replace view public.core_job_dlq as
select id, user_id, job_type, aggregate_type, aggregate_id, payload,
       attempts, max_attempts, last_error, created_at, updated_at
from public.core_job_queue
where status = 'dead';

revoke all on public.core_job_dlq from public, anon, authenticated;
grant select on public.core_job_dlq to service_role;
