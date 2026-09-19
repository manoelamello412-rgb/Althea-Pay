create or replace function public.get_checkout_transaction_status(p_checkout_session_id uuid)
returns table(transaction_id uuid,status text,external_id text,amount numeric,currency text,gateway_id text,updated_at timestamptz,completed_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  if auth.role() not in ('anon','authenticated') then raise exception 'forbidden'; end if;
  return query
  select gt.id,gt.status,gt.external_id,gt.amount,gt.currency,gt.gateway_id,gt.updated_at,gt.completed_at
  from public.gateway_transactions gt
  where gt.metadata->>'checkout_session_id'=p_checkout_session_id::text
    and gt.organization_id=(select cs.organization_id from public.checkout_sessions cs where cs.id=p_checkout_session_id)
  order by gt.created_at desc limit 1;
end; $$;
revoke all on function public.get_checkout_transaction_status(uuid) from public;
grant execute on function public.get_checkout_transaction_status(uuid) to anon,authenticated;
