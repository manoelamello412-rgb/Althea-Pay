create or replace function public.resolve_conversation_for_event(
  p_event_source text,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_checkout_id uuid;
  v_transaction_id text;
  v_org uuid;
  v_candidates uuid[];
  v_count int;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  if p_event_source = 'recovery_events' then
    select checkout_id, organization_id into v_checkout_id, v_org
    from public.recovery_events
    where id = p_event_id and user_id = v_user;
  elsif p_event_source = 'checkout_events' then
    select checkout_id, organization_id into v_checkout_id, v_org
    from public.checkout_events
    where id = p_event_id and user_id = v_user;
  elsif p_event_source = 'crm_webhook_events' then
    select transaction_id into v_transaction_id
    from public.crm_webhook_events
    where id = p_event_id and user_id = v_user;
  else
    raise exception 'invalid_event_source' using errcode='22023';
  end if;

  if not found then
    raise exception 'event_not_found' using errcode='P0002';
  end if;

  -- validação de organização quando o evento é organization-scoped
  if v_org is not null and not private.is_org_member(v_org) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if v_checkout_id is null and v_transaction_id is null then
    return jsonb_build_object(
      'event_id', p_event_id, 'conversation_id', null, 'context_status', 'unlinked'
    );
  end if;

  -- vínculo forte apenas: checkout_id gravado explicitamente na conversa, ou
  -- transaction_id exato. Nunca e-mail, nunca funil/produto por aproximação.
  select array_agg(id) into v_candidates
  from public.crm_conversations
  where user_id = v_user
    and (
      (v_checkout_id is not null and metadata->>'checkout_id' = v_checkout_id::text)
      or (v_transaction_id is not null and transaction_id = v_transaction_id)
    );

  v_count := coalesce(array_length(v_candidates, 1), 0);

  if v_count = 0 then
    return jsonb_build_object(
      'event_id', p_event_id, 'conversation_id', null, 'context_status', 'unlinked'
    );
  elsif v_count = 1 then
    return jsonb_build_object(
      'event_id', p_event_id, 'conversation_id', v_candidates[1], 'context_status', 'resolved'
    );
  else
    return jsonb_build_object(
      'event_id', p_event_id, 'conversation_id', null,
      'context_status', 'ambiguous', 'candidate_count', v_count
    );
  end if;
end;
$function$;

revoke all on function public.resolve_conversation_for_event(text, uuid) from public;
revoke all on function public.resolve_conversation_for_event(text, uuid) from anon;
grant execute on function public.resolve_conversation_for_event(text, uuid) to authenticated;
