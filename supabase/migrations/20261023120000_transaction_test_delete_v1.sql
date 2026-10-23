-- "Excluir" for test payments: the transaction goes to the bin (deleted_at) instead of being removed.
-- gateway_transactions is the ledger root (attempts, refunds with on delete restrict, financial journals,
-- reconciliation, subscriptions), so a hard delete would either fail or orphan financial history.
-- Binned rows leave Pagamentos, the dashboard figures and the recent activity; the sale they projected
-- stops counting as revenue. Owner/admin only, audited.
-- ponytail: other readers (customer 360, recovery workers) still see binned rows; filter them there if test rows show up.

alter table public.gateway_transactions add column if not exists deleted_at timestamptz;
alter table public.gateway_transactions add column if not exists deleted_by uuid references auth.users(id) on delete set null;
create index if not exists gateway_transactions_org_live_idx on public.gateway_transactions(organization_id, created_at desc) where deleted_at is null;

create or replace function public.transaction_delete(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_tx public.gateway_transactions;
begin
  if v_org is null or not private.has_org_role(v_org, array['owner', 'admin']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.gateway_transactions set deleted_at = now(), deleted_by = auth.uid()
   where id = p_transaction_id and organization_id = v_org and deleted_at is null
  returning * into v_tx;
  if not found then raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'transaction.deleted', 'gateway_transaction', p_transaction_id::text,
          jsonb_build_object('status', v_tx.status, 'amount', v_tx.amount, 'currency', v_tx.currency, 'email', v_tx.customer->>'email'));
end;
$function$;
revoke all on function public.transaction_delete(uuid) from public, anon;
grant execute on function public.transaction_delete(uuid) to authenticated;

-- Same contract as 20261014100000, without binned transactions.
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
  -- Attendants (customer service only) never read payments or financial figures.
  if private.has_org_role(v_org, array['attendant']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_days is not null and p_days not between 1 and 366 then raise exception 'INVALID_PERIOD' using errcode='22023'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'INVALID_CURSOR' using errcode='22023'; end if;
  if v_search is not null and length(v_search) > 120 then raise exception 'SEARCH_TOO_LONG' using errcode='22001'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_since := case when p_days is null then null else now() - make_interval(days => p_days) end;

  with filtered as (
    select t.*
      from public.gateway_transactions t
     where t.organization_id = v_org and t.deleted_at is null
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

-- Same contract as 20261014110000, without binned transactions.
create or replace function public.dashboard_recent_activity_v1(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_values boolean;
  v_customers boolean;
  v_chats boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v jsonb;
begin
  if auth.uid() is null or v_org is null or not private.is_org_member(v_org) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  -- Attendants (customer service only) never read payments or financial figures.
  if private.has_org_role(v_org, array['attendant']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_customers := private.has_org_capability(v_org, 'can_view_customers');
  v_chats := private.has_org_capability(v_org, 'can_view_chats');

  select coalesce(jsonb_agg(item order by (item->>'at')::timestamptz desc), '[]'::jsonb) into v
    from (
      select item from (
        (select jsonb_build_object('kind','payment','at',t.updated_at,'id',t.id,'status',t.status,
                 'amount',case when v_values then t.amount end,'currency',t.currency,'payment_method',t.metadata->>'payment_method',
                 'name',coalesce(t.customer->>'name',t.customer->>'full_name',t.customer->>'email')) as item
           from public.gateway_transactions t where t.organization_id = v_org and t.deleted_at is null order by t.updated_at desc limit v_limit)
        union all
        (select jsonb_build_object('kind','customer','at',c.created_at,'id',c.id) || private.client_card_json(c.data)
           from public.clients c where v_customers and c.organization_id = v_org order by c.created_at desc limit v_limit)
        union all
        (select jsonb_build_object('kind','call','at',a.created_at,'id',a.client_id,'outcome',a.outcome)
                 || private.client_card_json((select data from public.clients where id = a.client_id))
           from public.crm_call_attempts a where v_customers and a.organization_id = v_org order by a.created_at desc limit v_limit)
        union all
        (select jsonb_build_object('kind','conversation','at',x.created_at,'id',x.id,'channel',x.primary_channel,'name',coalesce(x.buyer_name,x.buyer_email))
           from public.crm_conversations x where v_chats and x.organization_id = v_org order by x.created_at desc limit v_limit)
      ) sources
      order by (item->>'at')::timestamptz desc
      limit v_limit
    ) latest;
  return jsonb_build_object('items', v);
end;
$function$;
revoke all on function public.dashboard_recent_activity_v1(integer) from public, anon;
grant execute on function public.dashboard_recent_activity_v1(integer) to authenticated;

