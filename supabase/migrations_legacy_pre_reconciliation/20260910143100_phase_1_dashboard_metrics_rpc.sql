create or replace function public.dashboard_metrics_for_user(p_start_date date, p_end_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  approved_revenue numeric := 0;
  paid_sales bigint := 0;
  waiting_pix bigint := 0;
  checkout_hits bigint := 0;
  conversion_rate numeric := 0;
  gateways jsonb := '[]'::jsonb;
  measured_at timestamptz := now();
begin
  if uid is null then
    raise exception using errcode = '28000', message = 'dashboard_unauthorized';
  end if;

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception using errcode = '22023', message = 'dashboard_invalid_date_range';
  end if;

  select
    coalesce(sum(amount) filter (where lower(coalesce(status, '')) = 'approved'), 0),
    count(*) filter (where lower(coalesce(status, '')) = 'approved'),
    count(*) filter (
      where lower(coalesce(status, '')) = 'pending'
        and lower(coalesce(data->>'payment_method', data->>'payment_type', data->>'method', '')) = 'pix'
    )
  into approved_revenue, paid_sales, waiting_pix
  from public.sales
  where user_id = uid
    and ((coalesce(occurred_at, created_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date);

  select count(*)
  into checkout_hits
  from public.checkout_sessions
  where user_id = uid
    and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date);

  if checkout_hits > 0 then
    conversion_rate := round((paid_sales::numeric / checkout_hits::numeric) * 100, 1);
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.gateway_name), '[]'::jsonb)
  into gateways
  from (
    select distinct on (coalesce(gateway_id::text, gateway_name))
      coalesce(gateway_id::text, gateway_name) as gateway_code,
      gateway_name,
      is_healthy as is_operational,
      latency_ms,
      circuit_state,
      checked_at
    from public.gateway_health_snapshots
    where user_id = uid
    order by coalesce(gateway_id::text, gateway_name), checked_at desc
  ) g;

  select greatest(
    coalesce(max(updated_at), '-infinity'::timestamptz),
    coalesce(max(occurred_at), '-infinity'::timestamptz)
  )
  into measured_at
  from public.sales
  where user_id = uid
    and ((coalesce(occurred_at, created_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date);

  measured_at := greatest(
    measured_at,
    coalesce((select max(checked_at) from public.gateway_health_snapshots where user_id = uid), '-infinity'::timestamptz)
  );

  if measured_at = '-infinity'::timestamptz then
    measured_at := now();
  end if;

  return jsonb_build_object(
    'revenue', approved_revenue,
    'paidSales', paid_sales,
    'waitingPix', waiting_pix,
    'checkoutHits', checkout_hits,
    'conversionRate', conversion_rate,
    'gateways', gateways,
    'measuredAt', measured_at
  );
end;
$$;

revoke all on function public.dashboard_metrics_for_user(date, date) from public, anon;
grant execute on function public.dashboard_metrics_for_user(date, date) to authenticated;
