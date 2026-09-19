create or replace function public.dashboard_operational_data_for_user(
  p_start_date date,
  p_end_date date,
  p_product text default null,
  p_funnel text default null,
  p_gateway text default null,
  p_status text default null,
  p_source text default null,
  p_campaign text default null,
  p_currency text default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  result jsonb;
  sale_filter text;
  checkout_filter text;
begin
  if uid is null then raise exception using errcode='28000', message='dashboard_unauthorized'; end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then raise exception using errcode='22023', message='dashboard_invalid_date_range'; end if;

  sale_filter := format($sql$
    s.user_id = %L::uuid
    and ((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    and ($1 is null or s.product_id = $1)
    and ($2 is null or s.funnel_id = $2)
    and ($3 is null or s.gateway_id = $3)
    and ($4 is null or lower(coalesce(s.status,'')) = lower($4))
    and ($5 is null or coalesce(s.source,s.attribution->>'source') = $5)
    and ($6 is null or coalesce(s.campaign,s.attribution->>'campaign') = $6)
    and ($7 is null or lower(coalesce(s.currency,'')) = lower($7))
    and ($8 is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method','')) = lower($8))
  $sql$, uid, p_start_date, p_end_date);

  checkout_filter := format($sql$
    c.user_id = %L::uuid
    and ((c.created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    and ($1 is null or c.product_id = $1)
    and ($2 is null or c.funnel_id = $2)
    and ($7 is null or lower(coalesce(c.currency,'')) = lower($7))
  $sql$, uid, p_start_date, p_end_date);

  execute format($sql$
    with sales_base as (
      select s.* from public.sales s where %s
    ), checkout_base as (
      select c.* from public.checkout_sessions c where %s
    ),
    approved as (select count(*) n, coalesce(sum(amount),0) revenue from sales_base where lower(coalesce(status,''))='approved'),
    sales_counts as (
      select count(*) total,
        count(*) filter(where lower(coalesce(status,''))='approved') approved,
        count(*) filter(where lower(coalesce(status,'')) in ('pending','processing')) pending,
        count(*) filter(where lower(coalesce(status,'')) in ('declined','failed','rejected')) declined,
        count(*) filter(where lower(coalesce(status,''))='cancelled') cancelled,
        count(*) filter(where lower(coalesce(status,''))='refunded') refunded,
        count(*) filter(where lower(coalesce(status,''))='chargeback') chargebacks
      from sales_base
    ),
    checkout_counts as (
      select count(*) visits,
        count(*) filter(where lower(coalesce(status,'')) in ('started','pending','processing')) started,
        count(*) filter(where completed_at is not null or lower(coalesce(status,'')) in ('completed','paid','approved')) completed,
        count(*) filter(where abandoned_at is not null or lower(coalesce(status,''))='abandoned') abandoned
      from checkout_base
    ),
    clients_base as (
      select count(*) total from public.clients where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    funnel_base as (
      select count(*) total from public.funnels where user_id=%L::uuid and deleted_at is null
    ),
    affiliate_base as (
      select count(*) affiliates from public.affiliate_profiles where user_id=%L::uuid,
      commissions as (select count(*) rows, coalesce(sum(amount_distributed),0) amount from public.affiliate_commissions where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    gateway_base as (
      select count(distinct gateway_id) gateways, count(*) attempts,
        count(*) filter(where lower(coalesce(status,'')) in ('approved','success','succeeded','completed')) approved,
        count(*) filter(where lower(coalesce(status,'')) in ('failed','declined','rejected','error')) failed
      from public.gateway_payment_attempts where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    crm_base as (
      select count(*) conversations,
        count(*) filter(where unread_count > 0) unread,
        count(*) filter(where lower(coalesce(status,'')) in ('open','pending','waiting')) open
      from public.crm_conversations where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    ops_base as (
      select count(*) events,
        count(*) filter(where lower(coalesce(status,'')) in ('failed','error','dead_letter')) failed,
        count(*) filter(where processed_at is null) pending
      from public.integration_events where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    security_base as (
      select count(*) events,
        count(*) filter(where lower(action) like '%%login%%' or lower(action) like '%%auth%%') auth_events
      from public.audit_logs where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    dispute_base as (
      select count(*) disputes, coalesce(sum(amount),0) amount from public.disputes where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    refund_base as (
      select count(*) refunds, coalesce(sum(amount),0) amount from public.gateway_refunds where user_id=%L::uuid and ((created_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)
    ),
    trends as (
      select d::date day,
        coalesce((select sum(amount) from sales_base x where lower(coalesce(x.status,''))='approved' and (coalesce(x.occurred_at,x.created_at) at time zone 'America/Sao_Paulo')::date=d::date),0) revenue,
        coalesce((select count(*) from sales_base x where lower(coalesce(x.status,''))='approved' and (coalesce(x.occurred_at,x.created_at) at time zone 'America/Sao_Paulo')::date=d::date),0) sales,
        coalesce((select count(*) from checkout_base x where (x.created_at at time zone 'America/Sao_Paulo')::date=d::date),0) checkouts
      from generate_series(%L::date,%L::date,'1 day') d
    ),
    filter_options as (
      select
        coalesce((select jsonb_agg(distinct product_id) filter(where product_id is not null and product_id <> '') from sales_base),'[]'::jsonb) products,
        coalesce((select jsonb_agg(distinct funnel_id) filter(where funnel_id is not null and funnel_id <> '') from sales_base),'[]'::jsonb) funnels,
        coalesce((select jsonb_agg(distinct gateway_id) filter(where gateway_id is not null and gateway_id <> '') from sales_base),'[]'::jsonb) gateways,
        coalesce((select jsonb_agg(distinct status) filter(where status is not null and status <> '') from sales_base),'[]'::jsonb) statuses,
        coalesce((select jsonb_agg(distinct currency) filter(where currency is not null and currency <> '') from sales_base),'[]'::jsonb) currencies,
        coalesce((select jsonb_agg(distinct source) filter(where source is not null and source <> '') from sales_base),'[]'::jsonb) sources,
        coalesce((select jsonb_agg(distinct campaign) filter(where campaign is not null and campaign <> '') from sales_base),'[]'::jsonb) campaigns,
        coalesce((select jsonb_agg(distinct lower(data->>'payment_method')) filter(where data->>'payment_method' is not null and data->>'payment_method' <> '') from sales_base),'[]'::jsonb) payment_methods
    )
    select jsonb_build_object(
      'financial', jsonb_build_object('revenue',approved.revenue,'approved',approved.n,'pending',(select pending from sales_counts),'refunds',(select refunds from refund_base),'refundAmount',(select amount from refund_base),'disputes',(select disputes from dispute_base),'disputeAmount',(select amount from dispute_base)),
      'sales', jsonb_build_object('total',(select total from sales_counts),'approved',(select approved from sales_counts),'pending',(select pending from sales_counts),'declined',(select declined from sales_counts),'cancelled',(select cancelled from sales_counts),'refunded',(select refunded from sales_counts),'chargebacks',(select chargebacks from sales_counts),'averageTicket',case when (select approved from sales_counts)>0 then round(approved.revenue/(select approved from sales_counts),2) else 0 end),
      'funnels', jsonb_build_object('total',(select total from funnel_base),'visits',(select visits from checkout_counts),'leads',(select count(*) from attribution_sessions where user_id=%L::uuid and ((first_seen_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)),'sales',(select approved from sales_counts),'revenue',approved.revenue),
      'checkouts', jsonb_build_object('visits',(select visits from checkout_counts),'started',(select started from checkout_counts),'completed',(select completed from checkout_counts),'abandoned',(select abandoned from checkout_counts),'conversion',case when (select visits from checkout_counts)>0 then round(((select completed from checkout_counts)::numeric/(select visits from checkout_counts))*100,1) else 0 end),
      'products', jsonb_build_object('sales',(select approved from sales_counts),'revenue',approved.revenue,'averageTicket',case when (select approved from sales_counts)>0 then round(approved.revenue/(select approved from sales_counts),2) else 0 end),
      'clients', jsonb_build_object('total',(select total from clients_base),'new',(select total from clients_base),'recurring',0,'active',0,'retention',0,'repurchase',0,'ltv',0),
      'payments', jsonb_build_object('approved',(select approved from sales_counts),'declined',(select declined from sales_counts),'pending',(select pending from sales_counts),'cancelled',(select cancelled from sales_counts),'refunds',(select refunds from refund_base),'chargebacks',(select chargebacks from sales_counts)),
      'gateways', jsonb_build_object('count',(select gateways from gateway_base),'attempts',(select attempts from gateway_base),'approved',(select approved from gateway_base),'failed',(select failed from gateway_base),'approvalRate',case when (select attempts from gateway_base)>0 then round(((select approved from gateway_base)::numeric/(select attempts from gateway_base))*100,1) else 0 end),
      'subscriptions', jsonb_build_object('available',false,'reason','subscription_source_not_available'),
      'affiliates', jsonb_build_object('count',(select affiliates from affiliate_base),'sales',(select approved from sales_counts),'revenue',approved.revenue,'commissions',(select amount from commissions)),
      'marketing', jsonb_build_object('leads',(select count(*) from attribution_sessions where user_id=%L::uuid and ((first_seen_at at time zone 'America/Sao_Paulo')::date between %L::date and %L::date)),'sales',(select approved from sales_counts),'revenue',approved.revenue),
      'crm', jsonb_build_object('conversations',(select conversations from crm_base),'unread',(select unread from crm_base),'open',(select open from crm_base)),
      'operations', jsonb_build_object('events',(select events from ops_base),'failed',(select failed from ops_base),'pending',(select pending from ops_base)),
      'security', jsonb_build_object('events',(select events from security_base),'authEvents',(select auth_events from security_base)),
      'activity', jsonb_build_object('events',(select events from security_base)),
      'alerts', jsonb_build_object('failedOperations',(select failed from ops_base),'gatewayFailures',(select failed from gateway_base),'unreadCrm',(select unread from crm_base),'disputes',(select disputes from dispute_base)),
      'intelligence', jsonb_build_object('revenue',approved.revenue,'sales',(select approved from sales_counts),'conversion',(select conversion from checkout_counts)),
      'trends',coalesce((select jsonb_agg(to_jsonb(trends) order by day) from trends),'[]'::jsonb),
      'filters',(select to_jsonb(filter_options)),
      'measuredAt',now()
    )
  $sql$, sale_filter, checkout_filter, uid,p_start_date,p_end_date, uid, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date, p_start_date,p_end_date, uid,p_start_date,p_end_date, uid,p_start_date,p_end_date);
  return result;
end;
$function$;

grant execute on function public.dashboard_operational_data_for_user(date,date,text,text,text,text,text,text,text,text) to authenticated;