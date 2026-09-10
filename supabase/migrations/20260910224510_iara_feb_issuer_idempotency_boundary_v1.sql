begin;

create or replace function public.iara_reserve_feb_issuance(p_tenant_id uuid,p_idempotency_key text,p_tool_key text,p_tool_version integer,p_request_hash text,p_execution_id uuid)
returns table(acquired boolean,idempotency_id uuid,execution_id uuid,request_hash text,status text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare v public.iara_execution_idempotency%rowtype;
begin
  if p_tenant_id is null or nullif(trim(p_idempotency_key),'') is null or nullif(trim(p_tool_key),'') is null or p_tool_version <= 0 or nullif(trim(p_request_hash),'') is null or p_execution_id is null then raise exception 'invalid_feb_idempotency_arguments'; end if;
  begin
    insert into public.iara_execution_idempotency(tenant_id,idempotency_key,tool_key,tool_version,request_hash,execution_id,status)
    values(p_tenant_id,p_idempotency_key,p_tool_key,p_tool_version,p_request_hash,p_execution_id,'RUNNING')
    returning * into v;
    return query select true,v.idempotency_id,v.execution_id,v.request_hash,v.status;
  exception when unique_violation then
    select * into v from public.iara_execution_idempotency where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
    if not found then raise exception 'feb_idempotency_race_unresolved'; end if;
    if v.request_hash <> p_request_hash then raise exception 'idempotency_key_reused_with_different_request'; end if;
    return query select false,v.idempotency_id,v.execution_id,v.request_hash,v.status;
  end;
end;
$$;

revoke all on function public.iara_reserve_feb_issuance(uuid,text,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.iara_reserve_feb_issuance(uuid,text,text,integer,text,uuid) to service_role;

commit;
