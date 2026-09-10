create or replace function public.gateway_orchestration_trace_require_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transaction_id is null then
    raise exception 'gateway_orchestration_trace_transaction_required';
  end if;
  if not exists (
    select 1 from public.gateway_transactions t
    where t.id = new.transaction_id and t.user_id = new.tenant_id
  ) then
    raise exception 'gateway_orchestration_trace_transaction_tenant_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function public.gateway_orchestration_trace_require_transaction() from public, anon, authenticated;
grant execute on function public.gateway_orchestration_trace_require_transaction() to service_role;
drop trigger if exists trg_gateway_orchestration_trace_require_transaction on public.gateway_orchestration_traces;
create trigger trg_gateway_orchestration_trace_require_transaction
before insert or update of transaction_id, tenant_id
on public.gateway_orchestration_traces
for each row execute function public.gateway_orchestration_trace_require_transaction();

create or replace function public.gateway_cleanup_orphan_orchestration_traces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  delete from public.gateway_orchestration_traces where transaction_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.gateway_cleanup_orphan_orchestration_traces() from public, anon, authenticated;
grant execute on function public.gateway_cleanup_orphan_orchestration_traces() to service_role;
