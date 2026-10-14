-- Analytics v1: the analytics page used to download up to 10k transactions and 10k checkout
-- sessions and compute metrics in the browser. This RPC aggregates server-side, scoped to the
-- caller's current organization, with product/gateway/funnel/status filters.
-- Amounts are returned only with can_view_values; counts are visible to every member.
-- checkout_sessions has no gateway, so the gateway filter does not narrow checkout conversion.

create or replace function public.analytics_summary_v1(
  p_days integer default 30,
  p_funnel_id text default null,
  p_product_id text default null,
  p_gateway_id text default null,
  p_status text default null
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
  v_since timestamptz;
  v jsonb;
begin
  if auth.uid() is null or v_org is null or not private.is_org_member(v_org) then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then raise exception 'INVALID_PERIOD' using errcode='22023'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_since := now() - make_interval(days => p_days);

  with tx as (
    select t.status, t.funnel_id::text as funnel_id, t.amount, upper(coalesce(nullif(trim(t.currency), ''), 'BRL')) as currency
      from public.gateway_transactions t
     where t.organization_id = v_org
       and t.created_at >= v_since
       and (p_funnel_id is null or t.funnel_id::text = p_funnel_id)
       and (p_product_id is null or t.product_id::text = p_product_id)
       and (p_gateway_id is null or t.gateway_id::text = p_gateway_id)
       and (p_status is null or t.status = p_status)
  ),
  revenue as (
    select currency, sum(amount) as amount, count(*) as approved
      from tx where status = 'approved' group by currency
  ),
  funnel_rows as (
    select funnel_id, count(*) as total, count(*) filter (where status = 'approved') as approved,
           sum(amount) filter (where status = 'approved') as gross,
           count(distinct currency) filter (where status = 'approved') as currency_count,
           min(currency) filter (where status = 'approved') as currency
      from tx group by funnel_id
     order by approved desc, total desc
     limit 8
  ),
  co as (
    select count(*) as started, count(*) filter (where c.status = 'completed' or c.completed_at is not null) as completed
      from public.checkout_sessions c
     where c.organization_id = v_org
       and c.created_at >= v_since
       and (p_funnel_id is null or c.funnel_id::text = p_funnel_id)
       and (p_product_id is null or c.product_id::text = p_product_id)
  )
  select jsonb_build_object(
    'can_view_values', v_values,
    'transactions', (select count(*) from tx),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from tx group by status) s), '{}'::jsonb),
    'revenue', case when v_values then coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount, 'approved', approved) order by amount desc) from revenue), '[]'::jsonb) end,
    'checkouts', (select jsonb_build_object('started', started, 'completed', completed) from co),
    'by_funnel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'funnel_id', r.funnel_id, 'name', f.nome, 'total', r.total, 'approved', r.approved,
        'gross', case when v_values and r.currency_count <= 1 then coalesce(r.gross, 0) end,
        'currency', r.currency, 'currency_count', r.currency_count
      ) order by r.approved desc, r.total desc)
        from funnel_rows r
        left join public.funnels f on f.id::text = r.funnel_id and f.organization_id = v_org
    ), '[]'::jsonb),
    'filters', jsonb_build_object(
      'funnels', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', nome) order by nome) from public.funnels where organization_id = v_org and deleted_at is null), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(name, id::text)) order by name) from public.products where organization_id = v_org), '[]'::jsonb),
      'gateways', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by display_name) from public.gateways where organization_id = v_org), '[]'::jsonb)
    )
  ) into v;
  return v;
end;
$function$;

revoke all on function public.analytics_summary_v1(integer, text, text, text, text) from public, anon;
grant execute on function public.analytics_summary_v1(integer, text, text, text, text) to authenticated;
