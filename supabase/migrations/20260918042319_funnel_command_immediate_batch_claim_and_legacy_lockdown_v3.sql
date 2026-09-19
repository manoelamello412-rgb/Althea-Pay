
drop function if exists public.claim_funnel_command_targets(text,integer);

create or replace function public.claim_funnel_command_targets(
  p_worker_id text,
  p_limit integer default 20,
  p_batch_id uuid default null
)
returns setof public.funnel_command_targets
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(trim(p_worker_id),'')='' then
    raise exception 'worker_id_required' using errcode='22023';
  end if;

  return query
  with candidates as (
    select t.id
    from public.funnel_command_targets t
    join public.funnel_command_batches b on b.id=t.batch_id
    where t.status in ('queued','retry')
      and b.status not in ('cancelled','preflight_failed','failed')
      and (p_batch_id is null or t.batch_id=p_batch_id)
      and (t.next_attempt_at is null or t.next_attempt_at<=now())
    order by t.created_at
    for update of t skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.funnel_command_targets t
     set status='running',
         worker_id=p_worker_id,
         claimed_at=now(),
         started_at=coalesce(started_at,now()),
         attempt_count=attempt_count+1,
         updated_at=now()
    from candidates c
   where t.id=c.id
  returning t.*;
end;
$$;

revoke all on function public.claim_funnel_command_targets(text,integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_funnel_command_targets(text,integer,uuid) to service_role;

revoke execute on function public.switch_all_funnel_primary_gateways(text) from authenticated;
grant execute on function public.switch_all_funnel_primary_gateways(text) to service_role;
