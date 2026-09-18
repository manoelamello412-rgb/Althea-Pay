CREATE INDEX IF NOT EXISTS checkout_sessions_org_funnel_created_idx ON public.checkout_sessions USING btree (organization_id, funnel_id, created_at DESC) WHERE (funnel_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS gateway_transactions_org_funnel_created_idx ON public.gateway_transactions USING btree (organization_id, funnel_id, created_at DESC) WHERE (funnel_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS gateway_transactions_org_gateway_created_idx ON public.gateway_transactions USING btree (organization_id, gateway_id, created_at DESC) WHERE (gateway_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.revenue_analytics_v1(p_days integer DEFAULT 30, p_funnel_id text DEFAULT NULL::text, p_gateway_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_days integer:=greatest(1,least(coalesce(p_days,30),365));
  v_now timestamptz:=now();
  v_start timestamptz;
  v_prev_start timestamptz;
  v_result jsonb;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  v_start:=v_now-make_interval(days=>v_days);
  v_prev_start:=v_start-make_interval(days=>v_days);

  with
  current_tx as (
    select t.*
    from public.gateway_transactions t
    where t.organization_id=v_org
      and t.created_at>=v_start and t.created_at<v_now
      and (p_funnel_id is null or p_funnel_id='' or t.funnel_id=p_funnel_id)
      and (p_gateway_id is null or p_gateway_id='' or t.gateway_id=p_gateway_id)
  ),
  previous_tx as (
    select t.*
    from public.gateway_transactions t
    where t.organization_id=v_org
      and t.created_at>=v_prev_start and t.created_at<v_start
      and (p_funnel_id is null or p_funnel_id='' or t.funnel_id=p_funnel_id)
      and (p_gateway_id is null or p_gateway_id='' or t.gateway_id=p_gateway_id)
  ),
  current_checkout as (
    select c.*
    from public.checkout_sessions c
    where c.organization_id=v_org
      and c.created_at>=v_start and c.created_at<v_now
      and (p_funnel_id is null or p_funnel_id='' or c.funnel_id=p_funnel_id)
  ),
  previous_checkout as (
    select c.*
    from public.checkout_sessions c
    where c.organization_id=v_org
      and c.created_at>=v_prev_start and c.created_at<v_start
      and (p_funnel_id is null or p_funnel_id='' or c.funnel_id=p_funnel_id)
  ),
  current_metrics as (
    select
      count(*)::bigint transactions,
      count(*) filter(where status='approved')::bigint approved_count,
      count(*) filter(where status in ('created','pending','processing'))::bigint pending_count,
      count(*) filter(where status='failed')::bigint failed_count,
      count(*) filter(where status='refunded')::bigint refunded_count,
      count(*) filter(where status='chargeback')::bigint chargeback_count,
      coalesce(sum(amount),0)::numeric gross_volume,
      coalesce(sum(amount) filter(where status='approved'),0)::numeric approved_volume,
      coalesce(avg(amount) filter(where status='approved'),0)::numeric average_ticket
    from current_tx
  ),
  previous_metrics as (
    select
      count(*)::bigint transactions,
      count(*) filter(where status='approved')::bigint approved_count,
      count(*) filter(where status='failed')::bigint failed_count,
      coalesce(sum(amount) filter(where status='approved'),0)::numeric approved_volume,
      coalesce(avg(amount) filter(where status='approved'),0)::numeric average_ticket
    from previous_tx
  ),
  current_checkout_metrics as (
    select
      count(*)::bigint checkouts,
      count(*) filter(where status='completed' or completed_at is not null)::bigint completed,
      count(*) filter(where status='abandoned')::bigint abandoned,
      count(*) filter(where recovery_status in ('pending','queued','processing','sent'))::bigint recovery_active,
      count(*) filter(where recovery_count>0)::bigint recovery_touched
    from current_checkout
  ),
  previous_checkout_metrics as (
    select
      count(*)::bigint checkouts,
      count(*) filter(where status='completed' or completed_at is not null)::bigint completed,
      count(*) filter(where status='abandoned')::bigint abandoned
    from previous_checkout
  ),
  calendar as (
    select generate_series(
      date_trunc('day',v_start),
      date_trunc('day',v_now),
      interval '1 day'
    ) as bucket_at
  ),
  daily_tx as (
    select
      date_trunc('day',created_at) as bucket_at,
      count(*)::bigint transactions,
      count(*) filter(where status='approved')::bigint approved,
      count(*) filter(where status='failed')::bigint failed,
      coalesce(sum(amount) filter(where status='approved'),0)::numeric revenue
    from current_tx
    group by 1
  ),
  daily_checkout as (
    select
      date_trunc('day',created_at) as bucket_at,
      count(*)::bigint checkouts,
      count(*) filter(where status='completed' or completed_at is not null)::bigint completed,
      count(*) filter(where status='abandoned')::bigint abandoned
    from current_checkout
    group by 1
  ),
  funnel_tx as (
    select
      coalesce(t.funnel_id,'sem_funil') as funnel_key,
      count(*)::bigint transactions,
      count(*) filter(where t.status='approved')::bigint approved,
      count(*) filter(where t.status='failed')::bigint failed,
      coalesce(sum(t.amount) filter(where t.status='approved'),0)::numeric revenue
    from current_tx t
    group by 1
  ),
  funnel_checkout as (
    select
      coalesce(c.funnel_id,'sem_funil') as funnel_key,
      count(*)::bigint checkouts,
      count(*) filter(where c.status='completed' or c.completed_at is not null)::bigint completed,
      count(*) filter(where c.status='abandoned')::bigint abandoned
    from current_checkout c
    group by 1
  ),
  gateway_tx as (
    select
      coalesce(t.gateway_id,'sem_gateway') as gateway_key,
      count(*)::bigint transactions,
      count(*) filter(where t.status='approved')::bigint approved,
      count(*) filter(where t.status='failed')::bigint failed,
      coalesce(sum(t.amount) filter(where t.status='approved'),0)::numeric revenue
    from current_tx t
    group by 1
  ),
  attempt_latency as (
    select
      coalesce(a.gateway_id,'sem_gateway') as gateway_key,
      coalesce(avg(a.duration_ms),0)::numeric average_duration_ms
    from public.gateway_payment_attempts a
    where a.organization_id=v_org
      and a.created_at>=v_start and a.created_at<v_now
      and (p_gateway_id is null or p_gateway_id='' or a.gateway_id=p_gateway_id)
      and (
        p_funnel_id is null or p_funnel_id='' or exists(
          select 1 from public.gateway_transactions t
          where t.id=a.transaction_id and t.organization_id=v_org and t.funnel_id=p_funnel_id
        )
      )
    group by 1
  ),
  status_distribution as (
    select status,count(*)::bigint as status_count,coalesce(sum(amount),0)::numeric as status_volume
    from current_tx
    group by status
  )
  select jsonb_build_object(
    'period',jsonb_build_object(
      'days',v_days,
      'start_at',v_start,
      'end_at',v_now,
      'previous_start_at',v_prev_start,
      'previous_end_at',v_start
    ),
    'filters',jsonb_build_object(
      'funnel_id',nullif(p_funnel_id,''),
      'gateway_id',nullif(p_gateway_id,''),
      'funnels',coalesce((
        select jsonb_agg(jsonb_build_object('id',f.id,'name',f.nome) order by f.nome)
        from public.funnels f
        where f.organization_id=v_org and f.deleted_at is null
      ),'[]'::jsonb),
      'gateways',coalesce((
        select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.display_name,g.provider,g.id),'provider',g.provider) order by coalesce(g.display_name,g.provider,g.id))
        from public.gateways g
        where g.organization_id=v_org
      ),'[]'::jsonb)
    ),
    'metrics',(
      select jsonb_build_object(
        'transactions',m.transactions,
        'approved_count',m.approved_count,
        'pending_count',m.pending_count,
        'failed_count',m.failed_count,
        'refunded_count',m.refunded_count,
        'chargeback_count',m.chargeback_count,
        'gross_volume',m.gross_volume,
        'approved_volume',m.approved_volume,
        'average_ticket',m.average_ticket,
        'approval_rate',case when m.transactions>0 then round(m.approved_count::numeric*100/m.transactions,2) else 0 end,
        'checkout_count',c.checkouts,
        'checkout_completed',c.completed,
        'checkout_abandoned',c.abandoned,
        'checkout_conversion',case when c.checkouts>0 then round(c.completed::numeric*100/c.checkouts,2) else 0 end,
        'recovery_active',c.recovery_active,
        'recovery_touched',c.recovery_touched
      )
      from current_metrics m cross join current_checkout_metrics c
    ),
    'previous',(
      select jsonb_build_object(
        'transactions',m.transactions,
        'approved_count',m.approved_count,
        'failed_count',m.failed_count,
        'approved_volume',m.approved_volume,
        'average_ticket',m.average_ticket,
        'approval_rate',case when m.transactions>0 then round(m.approved_count::numeric*100/m.transactions,2) else 0 end,
        'checkout_count',c.checkouts,
        'checkout_completed',c.completed,
        'checkout_abandoned',c.abandoned,
        'checkout_conversion',case when c.checkouts>0 then round(c.completed::numeric*100/c.checkouts,2) else 0 end
      )
      from previous_metrics m cross join previous_checkout_metrics c
    ),
    'daily',coalesce((
      select jsonb_agg(jsonb_build_object(
        'day',cal.bucket_at,
        'transactions',coalesce(t.transactions,0),
        'approved',coalesce(t.approved,0),
        'failed',coalesce(t.failed,0),
        'revenue',coalesce(t.revenue,0),
        'checkouts',coalesce(c.checkouts,0),
        'checkout_completed',coalesce(c.completed,0),
        'checkout_abandoned',coalesce(c.abandoned,0)
      ) order by cal.bucket_at)
      from calendar cal
      left join daily_tx t on t.bucket_at=cal.bucket_at
      left join daily_checkout c on c.bucket_at=cal.bucket_at
    ),'[]'::jsonb),
    'funnels',coalesce((
      select jsonb_agg(jsonb_build_object(
        'funnel_id',ft.funnel_key,
        'funnel_name',coalesce(f.nome,case when ft.funnel_key='sem_funil' then 'Sem funil' else ft.funnel_key end),
        'transactions',ft.transactions,
        'approved',ft.approved,
        'failed',ft.failed,
        'revenue',ft.revenue,
        'approval_rate',case when ft.transactions>0 then round(ft.approved::numeric*100/ft.transactions,2) else 0 end,
        'checkouts',coalesce(fc.checkouts,0),
        'checkout_completed',coalesce(fc.completed,0),
        'checkout_abandoned',coalesce(fc.abandoned,0),
        'checkout_conversion',case when coalesce(fc.checkouts,0)>0 then round(fc.completed::numeric*100/fc.checkouts,2) else 0 end
      ) order by ft.revenue desc,ft.transactions desc)
      from funnel_tx ft
      left join funnel_checkout fc on fc.funnel_key=ft.funnel_key
      left join public.funnels f on f.id=ft.funnel_key and f.organization_id=v_org
    ),'[]'::jsonb),
    'gateways',coalesce((
      select jsonb_agg(jsonb_build_object(
        'gateway_id',gt.gateway_key,
        'gateway_name',coalesce(g.display_name,g.provider,case when gt.gateway_key='sem_gateway' then 'Sem gateway' else gt.gateway_key end),
        'provider',g.provider,
        'transactions',gt.transactions,
        'approved',gt.approved,
        'failed',gt.failed,
        'revenue',gt.revenue,
        'approval_rate',case when gt.transactions>0 then round(gt.approved::numeric*100/gt.transactions,2) else 0 end,
        'average_duration_ms',coalesce(al.average_duration_ms,0)
      ) order by gt.revenue desc,gt.transactions desc)
      from gateway_tx gt
      left join attempt_latency al on al.gateway_key=gt.gateway_key
      left join public.gateways g on g.id=gt.gateway_key and g.organization_id=v_org
    ),'[]'::jsonb),
    'status_distribution',coalesce((
      select jsonb_agg(jsonb_build_object('status',s.status,'count',s.status_count,'volume',s.status_volume) order by s.status_count desc)
      from status_distribution s
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.revenue_analytics_v1(integer,text,text) from public,anon;

grant execute on function public.revenue_analytics_v1(integer,text,text) to authenticated;
