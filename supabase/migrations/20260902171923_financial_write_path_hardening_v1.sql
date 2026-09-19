drop policy if exists owner_insert on public.sales;
drop policy if exists owner_update on public.sales;
drop policy if exists owner_delete on public.sales;

revoke insert, update, delete on public.sales from authenticated;

revoke insert, update, delete on public.gateway_payment_attempts from authenticated;
revoke insert, update, delete on public.gateway_health_snapshots from authenticated;
revoke insert, update, delete on public.affiliate_commissions from authenticated;

create or replace function public.can_failover_payment(p_failure_class text)
returns boolean
language sql
immutable
security invoker
as $$
  select p_failure_class in ('technical','timeout','unavailable');
$$;

revoke all on function public.can_failover_payment(text) from public;
grant execute on function public.can_failover_payment(text) to authenticated, postgres, service_role;