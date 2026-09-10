begin;

create or replace function public.iara_complete_feb_issuance(p_idempotency_id uuid,p_success boolean,p_result jsonb default null,p_error text default null)
returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if p_idempotency_id is null then raise exception 'invalid_feb_idempotency_completion'; end if;
  update public.iara_execution_idempotency
  set status=case when p_success then 'COMPLETED' else 'FAILED' end,
      result=case when p_success then p_result else null end,
      error=case when p_success then null else coalesce(nullif(trim(p_error),''),'FINANCIAL_FEB_ISSUANCE_DENIED') end,
      completed_at=now()
  where idempotency_id=p_idempotency_id and status='RUNNING';
  return found;
end;
$$;

revoke all on function public.iara_complete_feb_issuance(uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.iara_complete_feb_issuance(uuid,boolean,jsonb,text) to service_role;

commit;
