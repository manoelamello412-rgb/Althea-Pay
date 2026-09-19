CREATE OR REPLACE FUNCTION public.transition_gateway_transaction(p_transaction_id uuid, p_next_status text, p_error_message text DEFAULT NULL::text)
RETURNS public.gateway_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
declare v public.gateway_transactions; c text; n text := lower(trim(coalesce(p_next_status,'')));
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if n not in ('created','pending','approved','failed','refunded','chargeback') then raise exception 'invalid_transaction_state'; end if;
  select status into c from public.gateway_transactions where id=p_transaction_id for update;
  if c is null then raise exception 'transaction_not_found'; end if;
  if c=n then select * into v from public.gateway_transactions where id=p_transaction_id; return v; end if;
  if c in ('refunded','chargeback','failed') then raise exception 'terminal_transaction_state'; end if;
  if n='created' then raise exception 'invalid_state_transition'; end if;
  if n='pending' and c not in ('created') then raise exception 'invalid_state_transition'; end if;
  if n='approved' and c not in ('created','pending') then raise exception 'invalid_state_transition'; end if;
  if n='failed' and c not in ('created','pending') then raise exception 'invalid_state_transition'; end if;
  if n='refunded' and c<>'approved' then raise exception 'invalid_state_transition'; end if;
  if n='chargeback' and c<>'approved' then raise exception 'invalid_state_transition'; end if;
  update public.gateway_transactions
  set status=n,
      error_message=coalesce(p_error_message,error_message),
      completed_at=case when n in ('approved','failed','refunded','chargeback') then coalesce(completed_at,now()) else completed_at end,
      updated_at=now()
  where id=p_transaction_id returning * into v;
  return v;
end $$;
REVOKE EXECUTE ON FUNCTION public.transition_gateway_transaction(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_gateway_transaction(uuid,text,text) TO service_role;