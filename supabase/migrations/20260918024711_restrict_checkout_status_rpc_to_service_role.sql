create or replace function public.get_checkout_transaction_status(p_checkout_session_id uuid)
returns table(
  transaction_id uuid,
  status text,
  external_id text,
  amount numeric,
  currency text,
  gateway_id text,
  updated_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    gt.id,
    gt.status,
    gt.external_id,
    gt.amount,
    gt.currency,
    gt.gateway_id,
    gt.updated_at,
    gt.completed_at
  from public.gateway_transactions gt
  where gt.metadata->>'checkout_session_id' = p_checkout_session_id::text
    and gt.organization_id = (
      select cs.organization_id
      from public.checkout_sessions cs
      where cs.id = p_checkout_session_id
    )
  order by gt.created_at desc
  limit 1;
end;
$function$;

revoke all on function public.get_checkout_transaction_status(uuid) from public, anon, authenticated;
grant execute on function public.get_checkout_transaction_status(uuid) to service_role;