create or replace function public.crm_operator_prepare_checkout_recovery(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.crm_conversations%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_funnel public.funnels%rowtype;
  v_now timestamptz := now();
  v_next timestamptz;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;

  select * into v_conversation
  from public.crm_conversations
  where id = p_conversation_id and user_id = v_user_id
  for update;

  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_checkout
  from public.checkout_sessions
  where user_id = v_user_id
    and (id = v_conversation.metadata->>'checkout_id' or id::text = coalesce(v_conversation.metadata->>'checkout_id',''))
  order by created_at desc
  limit 1
  for update;

  if not found and v_conversation.transaction_id is not null then
    select cs.* into v_checkout
    from public.checkout_sessions cs
    join public.gateway_transactions gt on gt.user_id = cs.user_id and gt.metadata->>'checkout_id' = cs.id::text
    where gt.user_id = v_user_id and gt.id::text = v_conversation.transaction_id
    order by cs.created_at desc
    limit 1
    for update;
  end if;

  if not found then
    select * into v_checkout
    from public.checkout_sessions
    where user_id = v_user_id
      and funnel_id = v_conversation.funnel_id
      and product_id is not distinct from v_conversation.product_id
      and status in ('started','processing','abandoned')
    order by updated_at desc
    limit 1
    for update;
  end if;

  if not found then raise exception 'checkout_session_not_found'; end if;

  if v_checkout.status in ('completed','paid') then
    raise exception 'checkout_already_completed';
  end if;

  v_next := case when v_checkout.recovery_next_at is null or v_checkout.recovery_next_at <= v_now then v_now + interval '15 minutes' else v_checkout.recovery_next_at end;

  update public.checkout_sessions
  set recovery_count = recovery_count + case when recovery_status = 'queued' and recovery_next_at > v_now then 0 else 1 end,
      recovery_status = case when recovery_status = 'queued' and recovery_next_at > v_now then 'queued' else 'queued' end,
      recovery_last_sent_at = case when recovery_status = 'queued' and recovery_next_at > v_now then recovery_last_sent_at else v_now end,
      recovery_next_at = v_next,
      updated_at = v_now
  where id = v_checkout.id and user_id = v_user_id
  returning * into v_checkout;

  if not exists (
    select 1 from public.checkout_events
    where user_id = v_user_id
      and checkout_id = v_checkout.id
      and event_type = 'recovery_queued'
      and created_at >= v_now - interval '2 seconds'
  ) then
    insert into public.checkout_events(user_id, checkout_id, event_type, payload)
    values (v_user_id, v_checkout.id, 'recovery_queued', jsonb_build_object('conversation_id', p_conversation_id, 'recovery_count', v_checkout.recovery_count, 'queued_at', v_now));
  end if;

  select * into v_funnel from public.funnels where id = v_checkout.funnel_id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'checkout_id', v_checkout.id,
    'checkout_status', v_checkout.status,
    'recovery_status', v_checkout.recovery_status,
    'recovery_count', v_checkout.recovery_count,
    'recovery_last_sent_at', v_checkout.recovery_last_sent_at,
    'recovery_next_at', v_checkout.recovery_next_at,
    'funnel_url', v_funnel.url,
    'funnel_id', v_checkout.funnel_id,
    'product_id', v_checkout.product_id,
    'amount', v_checkout.amount,
    'currency', v_checkout.currency
  );
exception
  when others then raise;
end;
$$;

revoke all on function public.crm_operator_prepare_checkout_recovery(uuid) from public;
grant execute on function public.crm_operator_prepare_checkout_recovery(uuid) to authenticated;