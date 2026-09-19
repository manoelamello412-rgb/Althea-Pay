create or replace function public.gateway_runtime_failover_status_recovery_guard()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status in ('approved','refunded') and nullif(trim(coalesce(new.external_id,'')),'') is null then
    raise exception 'gateway_external_id_required_for_terminal_state';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gateway_runtime_failover_status_recovery on public.gateway_transactions;
create trigger trg_gateway_runtime_failover_status_recovery
before insert or update of status, external_id on public.gateway_transactions
for each row execute function public.gateway_runtime_failover_status_recovery_guard();

revoke execute on function public.gateway_runtime_failover_status_recovery_guard() from public,anon,authenticated;
grant execute on function public.gateway_runtime_failover_status_recovery_guard() to service_role;
