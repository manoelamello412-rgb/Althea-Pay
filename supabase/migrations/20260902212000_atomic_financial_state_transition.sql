-- ALTHEA CORE: atomic financial state transition.
-- Keeps terminal financial states from being reopened by concurrent webhook deliveries.

create or replace function public.transition_gateway_transaction_status(
  p_transaction_id uuid,
  p_user_id uuid,
  p_next_status text,
  p_failure_code text default null,
  p_external_id text default null
)
returns public.gateway_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.gateway_transactions;
  v_next text := lower(trim(coalesce(p_next_status, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if v_next not in ('created', 'pending', 'approved', 'failed', 'refunded', 'chargeback') then
    raise exception 'invalid_status';
  end if;

  update public.gateway_transactions t
  set status = case
        when t.status = 'created' and v_next in ('created','pending','approved','failed') then v_next
        when t.status = 'pending' and v_next in ('pending','approved','failed','refunded','chargeback') then v_next
        when t.status = 'approved' and v_next in ('approved','refunded','chargeback') then v_next
        when t.status = 'failed' and v_next = 'failed' then v_next
        when t.status = 'refunded' and v_next = 'refunded' then v_next
        when t.status = 'chargeback' and v_next = 'chargeback' then v_next
        else t.status
      end,
      failure_code = coalesce(nullif(p_failure_code, ''), t.failure_code),
      external_id = coalesce(nullif(p_external_id, ''), t.external_id),
      completed_at = case
        when v_next in ('approved','refunded','chargeback') then coalesce(t.completed_at, now())
        else t.completed_at
      end,
      updated_at = now()
  where t.id = p_transaction_id
    and t.user_id = p_user_id
  returning t.* into v_row;

  if not found then
    raise exception 'transaction_not_found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.transition_gateway_transaction_status(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.transition_gateway_transaction_status(uuid,uuid,text,text,text) to service_role;
