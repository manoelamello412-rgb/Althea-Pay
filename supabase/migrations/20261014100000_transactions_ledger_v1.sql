-- Transactions ledger v1: paginated list, per-transaction history and receipt linking.
-- The gateway stays the source of truth; these RPCs only read what the webhooks already wrote.
--   list / detail:        organization member (same as the gateway_transactions RLS)
--     amounts:            also can_view_values
--     receipts:           also can_view_chats + can_view_values (same as opening the file)
--   link receipt:         can_reply_chats + can_view_values

create index if not exists gateway_transactions_org_created_idx on public.gateway_transactions(organization_id, created_at desc, id desc);
create index if not exists crm_messages_receipt_tx_idx on public.crm_messages((metadata->'attachment'->>'transaction_id'))
  where metadata->'attachment'->>'kind' = 'transfer_receipt';

-- Keyset pagination: pass the last row's (created_at, id) as p_before_* to get the next page.
create or replace function public.transactions_list_v1(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_status text default null,
  p_gateway_id text default null,
  p_funnel_id text default null,
  p_search text default null,
  p_days integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_values boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_since timestamptz;
  v_items jsonb;
  v_counts jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.is_org_member(v_org) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_days is not null and p_days not between 1 and 366 then raise exception 'INVALID_PERIOD' using errcode='22023'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'INVALID_CURSOR' using errcode='22023'; end if;
  if v_search is not null and length(v_search) > 120 then raise exception 'SEARCH_TOO_LONG' using errcode='22001'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_since := case when p_days is null then null else now() - make_interval(days => p_days) end;

  with filtered as (
    select t.*
      from public.gateway_transactions t
     where t.organization_id = v_org
       and (v_since is null or t.created_at >= v_since)
       and (p_gateway_id is null or t.gateway_id::text = p_gateway_id)
       and (p_funnel_id is null or t.funnel_id::text = p_funnel_id)
       and (v_search is null
            or t.id::text = v_search
            or lower(coalesce(t.external_id, '')) like '%' || v_search || '%'
            or lower(coalesce(t.customer->>'email', '')) like '%' || v_search || '%'
            or lower(coalesce(t.customer->>'name', t.customer->>'full_name', '')) like '%' || v_search || '%')
  ), page as (
    select * from filtered t
     where (p_status is null or t.status = p_status)
       and (p_before_created_at is null or (t.created_at, t.id) < (p_before_created_at, p_before_id))
     order by t.created_at desc, t.id desc
     limit v_limit + 1
  )
  select
    -- counts ignore the status filter, so the status chips always show the whole filtered set
    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from filtered group by status) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'status', t.status, 'external_id', t.external_id,
        'amount', case when v_values then t.amount end, 'currency', t.currency,
        'payment_method', t.metadata->>'payment_method',
        'customer_name', coalesce(t.customer->>'name', t.customer->>'full_name', t.customer->>'buyer_name'),
        'customer_email', t.customer->>'email',
        'funnel_id', t.funnel_id, 'funnel_name', f.nome,
        'product_id', t.product_id, 'product_name', p.name,
        'gateway_id', t.gateway_id, 'gateway_name', g.display_name, 'provider', g.provider,
        'error_message', t.error_message,
        'created_at', t.created_at, 'updated_at', t.updated_at, 'completed_at', t.completed_at
      ) order by t.created_at desc, t.id desc), '[]'::jsonb)
       from page t
       left join public.funnels f on f.id::text = t.funnel_id::text
       left join public.products p on p.id::text = t.product_id::text
       left join public.gateways g on g.id::text = t.gateway_id::text)
  into v_counts, v_items;

  return jsonb_build_object(
    'items', case when jsonb_array_length(v_items) > v_limit then v_items - v_limit else v_items end,
    'next_cursor', case when jsonb_array_length(v_items) > v_limit
                        then jsonb_build_object('created_at', v_items->(v_limit - 1)->'created_at', 'id', v_items->(v_limit - 1)->'id') end,
    'counts', v_counts,
    'can_view_values', v_values,
    'filters', jsonb_build_object(
      'gateways', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by display_name), '[]'::jsonb) from public.gateways where organization_id = v_org),
      'funnels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nome) order by nome), '[]'::jsonb) from public.funnels where organization_id = v_org and deleted_at is null)
    )
  );
end;
$function$;

create or replace function public.transaction_detail_v1(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_values boolean;
  v_receipts boolean;
  v_tx public.gateway_transactions;
  v_client text;
  v_email text;
  v_timeline jsonb;
  v_linked jsonb := '[]'::jsonb;
  v_candidates jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.is_org_member(v_org) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into v_tx from public.gateway_transactions where id = p_transaction_id and organization_id = v_org;
  if not found then raise exception 'TRANSACTION_NOT_FOUND' using errcode='P0002'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_receipts := v_values and private.has_org_capability(v_org, 'can_view_chats');
  v_email := lower(nullif(btrim(v_tx.customer->>'email'), ''));

  select customer_id into v_client from public.crm_conversations
   where organization_id = v_org and transaction_id = v_tx.id::text and customer_id is not null
   order by last_activity_at desc limit 1;
  if v_client is null and v_email is not null then
    select client_id into v_client from public.customer_identities
     where organization_id = v_org and kind = 'email' and value = v_email limit 1;
  end if;
  if v_client is null and v_email is not null then
    select id into v_client from public.clients
     where organization_id = v_org and lower(private.client_field(data, array['email', 'buyer_email', 'customer_email'])) = v_email
     order by created_at limit 1;
  end if;

  select coalesce(jsonb_agg(e order by (e->>'at')::timestamptz, e->>'source'), '[]'::jsonb) into v_timeline
    from (
      select jsonb_build_object('source', 'audit', 'at', a.created_at, 'type', a.event_type, 'status', a.status, 'origin', a.source) as e
        from public.transaction_audit_events a
       where a.transaction_id = v_tx.id and a.organization_id = v_org
      union all
      select jsonb_build_object('source', 'attempt', 'at', pa.created_at, 'type', 'gateway_attempt', 'status', pa.status,
               'gateway', pa.gateway_name, 'attempt_order', pa.attempt_order, 'response_code', pa.response_code,
               'error', coalesce(pa.error_message, pa.failure_class), 'duration_ms', pa.duration_ms, 'completed_at', pa.completed_at)
        from public.gateway_payment_attempts pa
       where pa.transaction_id = v_tx.id and pa.organization_id = v_org
      union all
      select jsonb_build_object('source', 'webhook', 'at', w.received_at, 'type', 'webhook', 'status', w.status,
               'provider', w.provider, 'provider_event_id', w.provider_event_id, 'attempts', w.attempts,
               'processed_at', w.processed_at, 'error', w.last_error)
        from public.gateway_webhook_events w
       where w.transaction_id = v_tx.id and w.organization_id = v_org
    ) x;

  if v_receipts then
    select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id, 'conversation_id', m.conversation_id, 'created_at', m.created_at,
             'file_name', m.metadata->'attachment'->>'file_name', 'mime_type', m.metadata->'attachment'->>'mime_type',
             'bucket', m.metadata->'attachment'->>'bucket', 'path', m.metadata->'attachment'->>'path') order by m.created_at desc), '[]'::jsonb)
      into v_linked
      from public.crm_messages m
      join public.crm_conversations c on c.id = m.conversation_id and c.organization_id = v_org
     where m.metadata->'attachment'->>'kind' = 'transfer_receipt'
       and m.metadata->'attachment'->>'transaction_id' = v_tx.id::text;

    -- receipts the same customer sent that are not tied to any transaction yet
    if v_client is not null then
      select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id, 'conversation_id', m.conversation_id, 'created_at', m.created_at,
               'file_name', m.metadata->'attachment'->>'file_name', 'mime_type', m.metadata->'attachment'->>'mime_type',
               'bucket', m.metadata->'attachment'->>'bucket', 'path', m.metadata->'attachment'->>'path') order by m.created_at desc), '[]'::jsonb)
        into v_candidates
        from public.crm_messages m
        join public.crm_conversations c on c.id = m.conversation_id and c.organization_id = v_org and c.customer_id = v_client
       where m.metadata->'attachment'->>'kind' = 'transfer_receipt'
         and nullif(m.metadata->'attachment'->>'transaction_id', '') is null;
    end if;
  end if;

  return jsonb_build_object(
    'transaction', jsonb_build_object(
      'id', v_tx.id, 'status', v_tx.status, 'external_id', v_tx.external_id,
      'amount', case when v_values then v_tx.amount end, 'currency', v_tx.currency,
      'payment_method', v_tx.metadata->>'payment_method', 'attempt_count', v_tx.attempt_count,
      'customer_name', coalesce(v_tx.customer->>'name', v_tx.customer->>'full_name', v_tx.customer->>'buyer_name'),
      'customer_email', v_tx.customer->>'email', 'customer_phone', coalesce(v_tx.customer->>'phone', v_tx.customer->>'whatsapp'),
      'funnel_id', v_tx.funnel_id, 'funnel_name', (select nome from public.funnels where id::text = v_tx.funnel_id::text),
      'product_id', v_tx.product_id, 'product_name', (select name from public.products where id::text = v_tx.product_id::text),
      'gateway_id', v_tx.gateway_id, 'gateway_name', (select display_name from public.gateways where id::text = v_tx.gateway_id::text),
      'error_message', v_tx.error_message, 'failure_code', v_tx.failure_code,
      'created_at', v_tx.created_at, 'updated_at', v_tx.updated_at, 'completed_at', v_tx.completed_at),
    'client_id', v_client,
    'conversation_id', (select id from public.crm_conversations where organization_id = v_org and (transaction_id = v_tx.id::text or (v_client is not null and customer_id = v_client)) order by (transaction_id = v_tx.id::text) desc, last_activity_at desc limit 1),
    'timeline', v_timeline,
    'receipts', v_linked,
    'receipt_candidates', v_candidates,
    'can_view_values', v_values,
    'can_view_receipts', v_receipts,
    'can_link_receipts', v_receipts and private.has_org_capability(v_org, 'can_reply_chats')
  );
end;
$function$;

-- Ties a buyer's transfer receipt to a transaction for manual reconciliation (null unlinks).
create or replace function public.crm_receipt_link_transaction(p_message_id uuid, p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_message public.crm_messages;
  v_from text;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not (private.has_org_capability(v_org, 'can_reply_chats') and private.has_org_capability(v_org, 'can_view_values')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select m.* into v_message
    from public.crm_messages m
    join public.crm_conversations c on c.id = m.conversation_id and c.organization_id = v_org
   where m.id = p_message_id
   for update of m;
  if not found or v_message.metadata->'attachment'->>'kind' is distinct from 'transfer_receipt' then
    raise exception 'RECEIPT_NOT_FOUND' using errcode='P0002';
  end if;
  if p_transaction_id is not null and not exists (select 1 from public.gateway_transactions where id = p_transaction_id and organization_id = v_org) then
    raise exception 'TRANSACTION_NOT_FOUND' using errcode='P0002';
  end if;

  v_from := nullif(v_message.metadata->'attachment'->>'transaction_id', '');
  if v_from is not distinct from p_transaction_id::text then
    return jsonb_build_object('message_id', v_message.id, 'transaction_id', p_transaction_id, 'changed', false);
  end if;

  update public.crm_messages
     set metadata = case when p_transaction_id is null
                         then metadata #- '{attachment,transaction_id}'
                         else jsonb_set(metadata, '{attachment,transaction_id}', to_jsonb(p_transaction_id::text)) end
   where id = v_message.id;

  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'crm.receipt.linked', 'crm_message', v_message.id::text,
          jsonb_build_object('conversation_id', v_message.conversation_id, 'from_transaction_id', v_from, 'to_transaction_id', p_transaction_id));
  return jsonb_build_object('message_id', v_message.id, 'transaction_id', p_transaction_id, 'changed', true);
end;
$function$;

revoke all on function public.transactions_list_v1(integer, timestamptz, uuid, text, text, text, text, integer) from public, anon;
revoke all on function public.transaction_detail_v1(uuid) from public, anon;
revoke all on function public.crm_receipt_link_transaction(uuid, uuid) from public, anon;
grant execute on function public.transactions_list_v1(integer, timestamptz, uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.transaction_detail_v1(uuid) to authenticated;
grant execute on function public.crm_receipt_link_transaction(uuid, uuid) to authenticated;
