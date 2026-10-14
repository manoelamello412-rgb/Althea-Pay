-- Dashboard v2: organization scope, value gating, recent activity and full analytics breakdown.
-- The main dashboard read dashboard_production_data_for_user, filtered by user_id = auth.uid(): members
-- of an organization saw an empty dashboard and the owner saw revenue regardless of can_view_values.
-- The same computation now runs for the caller's current organization (private.dashboard_production_data_org);
-- tables without organization_id (gateway_refunds, subscriptions, affiliate_*) are read through the
-- organization owner, like the CRM workers do.
-- ponytail: owner fallback misses rows a non-owner member wrote to those three tables; add organization_id to them when they get writers.
-- analytics_summary_v1 keeps its signature and gains by_product, by_gateway and leads.

create or replace function private.dashboard_production_data_org(
  p_org uuid,
  p_owner uuid,
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
) returns jsonb
language sql stable security definer set search_path=public
as $$
with params as (
  select p_start_date sd, p_end_date ed,
         (p_end_date-p_start_date+1) days,
         p_start_date-(p_end_date-p_start_date+1) prev_sd,
         p_start_date-1 prev_ed
),
sales as (
 select s.* from public.sales s, params p
 where s.organization_id=p_org
 and ((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p.sd and p.ed)
 and (p_product is null or s.product_id=p_product)
 and (p_funnel is null or s.funnel_id=p_funnel)
 and (p_gateway is null or s.gateway_id=p_gateway)
 and (p_status is null or lower(coalesce(s.status,''))=lower(p_status))
 and (p_source is null or coalesce(s.source,s.attribution->>'source')=p_source)
 and (p_campaign is null or coalesce(s.campaign,s.attribution->>'campaign')=p_campaign)
 and (p_currency is null or lower(coalesce(s.currency,''))=lower(p_currency))
 and (p_payment_method is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method',''))=lower(p_payment_method))
),
prev_sales as (
 select s.* from public.sales s, params p
 where s.organization_id=p_org
 and ((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p.prev_sd and p.prev_ed)
 and (p_product is null or s.product_id=p_product) and (p_funnel is null or s.funnel_id=p_funnel)
 and (p_gateway is null or s.gateway_id=p_gateway) and (p_status is null or lower(coalesce(s.status,''))=lower(p_status))
 and (p_source is null or coalesce(s.source,s.attribution->>'source')=p_source) and (p_campaign is null or coalesce(s.campaign,s.attribution->>'campaign')=p_campaign)
 and (p_currency is null or lower(coalesce(s.currency,''))=lower(p_currency))
 and (p_payment_method is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method',''))=lower(p_payment_method))
),
checkout as (
 select c.* from public.checkout_sessions c, params p where c.organization_id=p_org
 and (c.created_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
 and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel)
 and (p_currency is null or lower(coalesce(c.currency,''))=lower(p_currency))
),
prev_checkout as (
 select c.* from public.checkout_sessions c, params p where c.organization_id=p_org
 and (c.created_at at time zone 'America/Sao_Paulo')::date between p.prev_sd and p.prev_ed
 and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel)
 and (p_currency is null or lower(coalesce(c.currency,''))=lower(p_currency))
),
attribution as (
 select a.* from public.attribution_sessions a, params p where a.organization_id=p_org
 and (a.first_seen_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
 and (p_funnel is null or a.funnel_id=p_funnel) and (p_source is null or a.source=p_source) and (p_campaign is null or a.campaign=p_campaign)
),
prev_attribution as (
 select a.* from public.attribution_sessions a, params p where a.organization_id=p_org
 and (a.first_seen_at at time zone 'America/Sao_Paulo')::date between p.prev_sd and p.prev_ed
 and (p_funnel is null or a.funnel_id=p_funnel) and (p_source is null or a.source=p_source) and (p_campaign is null or a.campaign=p_campaign)
),
attempts as (
 select g.* from public.gateway_payment_attempts g, params p where g.organization_id=p_org
 and (g.created_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
 and (p_product is null or g.product_id=p_product) and (p_gateway is null or g.gateway_id=p_gateway)
 and (p_status is null or lower(coalesce(g.status,''))=lower(p_status))
),
refunds as (
 select r.* from public.gateway_refunds r where r.user_id=p_owner
 and (r.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
 and (p_gateway is null or r.gateway_id=p_gateway) and (p_currency is null or lower(coalesce(r.currency,''))=lower(p_currency))
 and (p_product is null or exists(select 1 from sales s where s.transaction_id=r.transaction_id and s.product_id=p_product))
),
disputes_base as (
 select d.* from public.disputes d where d.organization_id=p_org
 and (d.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
 and (p_gateway is null or d.gateway_id=p_gateway) and (p_currency is null or lower(coalesce(d.currency,''))=lower(p_currency))
 and (p_status is null or lower(coalesce(d.status,''))=lower(p_status))
),
crm as (
 select c.* from public.crm_conversations c, params p where c.organization_id=p_org
 and (c.created_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
 and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel)
),
ops as (
 select o.* from public.integration_events o, params p where o.organization_id=p_org
 and (o.created_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
 and (p_funnel is null or o.funnel_id=p_funnel)
),
subs as (
 select s.* from public.subscriptions s, params p where s.user_id=p_owner
 and (s.created_at at time zone 'America/Sao_Paulo')::date <= p.ed
 and (p_product is null or s.product_id=p_product) and (p_funnel is null or s.funnel_id=p_funnel)
 and (p_gateway is null or s.gateway_id=p_gateway) and (p_currency is null or lower(s.currency)=lower(p_currency))
),
metrics as (
 select
  coalesce(sum(amount) filter(where lower(coalesce(status,''))='approved'),0) revenue,
  count(*) filter(where lower(coalesce(status,''))='approved') approved,
  count(*) filter(where lower(coalesce(status,'')) in ('pending','processing')) pending,
  count(*) filter(where lower(coalesce(status,'')) in ('declined','failed','rejected')) declined,
  count(*) filter(where lower(coalesce(status,'')) in ('cancelled','canceled')) cancelled,
  count(*) filter(where lower(coalesce(status,''))='refunded') refunded,
  count(*) filter(where lower(coalesce(status,''))='chargeback') chargebacks,
  count(*) total from sales
),
prev_metrics as (
 select coalesce(sum(amount) filter(where lower(coalesce(status,''))='approved'),0) revenue,
  count(*) filter(where lower(coalesce(status,''))='approved') approved,
  count(*) total from prev_sales
),
checkout_metrics as (
 select count(*) visits, count(*) filter(where lower(coalesce(status,'')) in ('started','pending','processing')) started,
 count(*) filter(where completed_at is not null or lower(coalesce(status,'')) in ('completed','paid','approved')) completed,
 count(*) filter(where abandoned_at is not null or lower(coalesce(status,''))='abandoned') abandoned from checkout
),
prev_checkout_metrics as (
 select count(*) visits, count(*) filter(where completed_at is not null or lower(coalesce(status,'')) in ('completed','paid','approved')) completed from prev_checkout
),
client_rollup as (
 select coalesce(nullif(s.data->>'customer_id',''),nullif(s.data->>'customer_email',''),nullif(s.data->>'email',''),s.id) key,
 count(*) n,sum(s.amount) revenue,max((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date) last_date
 from sales s where lower(coalesce(s.status,''))='approved' group by 1
),
client_metrics as (
 select count(*) customers,count(*) filter(where n=1) new_clients,count(*) filter(where n>1) recurring,
 count(*) filter(where last_date between p_start_date and p_end_date) active,
 case when count(*)=0 then null else round(count(*) filter(where n>1)::numeric/count(*)*100,1) end repurchase,
 case when count(*)=0 then null else round(count(*) filter(where last_date between p_start_date and p_end_date)::numeric/count(*)*100,1) end retention,
 case when count(*)=0 then null else round(avg(revenue),2) end ltv from client_rollup
),
sub_metrics as (
 select count(*) total,
 count(*) filter(where status='active' and (ended_at is null or ended_at::date>p_end_date)) active,
 count(*) filter(where status='trialing') trialing,count(*) filter(where status='past_due') past_due,count(*) filter(where status='paused') paused,
 count(*) filter(where status='canceled' and ((coalesce(canceled_at,ended_at,updated_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)) canceled,
 coalesce(sum(case when status in ('active','trialing','past_due','paused') and (ended_at is null or ended_at::date>p_end_date) then case when billing_interval='month' then amount/nullif(interval_count,0) when billing_interval='year' then amount/(12*nullif(interval_count,0)) when billing_interval='week' then amount*52/(12*nullif(interval_count,0)) when billing_interval='day' then amount*365/(12*nullif(interval_count,0)) else 0 end else 0 end),0) mrr from subs
),
series as (
 select jsonb_agg(jsonb_build_object('date',d::date,'revenue',coalesce((select sum(s.amount) from sales s where (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date=d and lower(coalesce(s.status,''))='approved'),0),'sales',coalesce((select count(*) from sales s where (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date=d and lower(coalesce(s.status,''))='approved'),0),'checkoutVisits',coalesce((select count(*) from checkout c where (c.created_at at time zone 'America/Sao_Paulo')::date=d),0),'checkoutCompleted',coalesce((select count(*) from checkout c where (c.created_at at time zone 'America/Sao_Paulo')::date=d and (c.completed_at is not null or lower(coalesce(c.status,'')) in ('completed','paid','approved'))),0)) order by d) points from generate_series(p_start_date,p_end_date,'1 day'::interval) d
),
filters as (
 select jsonb_build_object(
 'product',coalesce((select jsonb_agg(v order by v) from (select distinct product_id v from sales where product_id is not null and product_id<>'') q),'[]'::jsonb),
 'funnel',coalesce((select jsonb_agg(v order by v) from (select distinct funnel_id v from sales where funnel_id is not null and funnel_id<>'') q),'[]'::jsonb),
 'gateway',coalesce((select jsonb_agg(v order by v) from (select distinct gateway_id v from attempts where gateway_id is not null and gateway_id<>'') q),'[]'::jsonb),
 'status',coalesce((select jsonb_agg(v order by v) from (select distinct status v from sales where status is not null and status<>'') q),'[]'::jsonb),
 'source',coalesce((select jsonb_agg(v order by v) from (select distinct source v from sales where source is not null and source<>'') q),'[]'::jsonb),
 'campaign',coalesce((select jsonb_agg(v order by v) from (select distinct campaign v from sales where campaign is not null and campaign<>'') q),'[]'::jsonb),
 'currency',coalesce((select jsonb_agg(v order by v) from (select distinct currency v from sales where currency is not null and currency<>'') q),'[]'::jsonb),
 'payment_method',coalesce((select jsonb_agg(v order by v) from (select distinct lower(coalesce(data->>'payment_method',data->>'payment_type',data->>'method')) v from sales where coalesce(data->>'payment_method',data->>'payment_type',data->>'method') is not null) q),'[]'::jsonb))
)
select jsonb_build_object(
 'period',jsonb_build_object('start',p_start_date,'end',p_end_date,'previousStart',(select prev_sd from params),'previousEnd',(select prev_ed from params)),
 'financial',jsonb_build_object('revenue',m.revenue,'approved',m.approved,'pending',m.pending,'refunds',(select count(*) from refunds),'refundAmount',coalesce((select sum(amount) from refunds),0),'disputes',(select count(*) from disputes_base),'disputeAmount',coalesce((select sum(amount) from disputes_base),0)),
 'sales',jsonb_build_object('total',m.total,'approved',m.approved,'pending',m.pending,'declined',m.declined,'cancelled',m.cancelled,'refunded',m.refunded,'chargebacks',m.chargebacks,'averageTicket',case when m.approved>0 then round(m.revenue/m.approved,2) else null end),
 'previous',jsonb_build_object('revenue',pm.revenue,'sales',pm.approved,'totalSales',pm.total,'conversion',case when (select visits from prev_checkout_metrics)>0 then round((select completed from prev_checkout_metrics)::numeric/(select visits from prev_checkout_metrics)*100,1) else null end),
 'checkouts',jsonb_build_object('visits',cm.visits,'started',cm.started,'completed',cm.completed,'abandoned',cm.abandoned,'conversion',case when cm.visits>0 then round(cm.completed::numeric/cm.visits*100,1) else null end),
 'funnels',jsonb_build_object('total',(select count(*) from public.funnels f where f.organization_id=p_org and f.deleted_at is null and (p_funnel is null or f.id=p_funnel)),'visits',(select count(*) from attribution),'leads',(select count(*) from attribution),'sales',m.approved,'revenue',m.revenue),
 'products',jsonb_build_object('sales',m.approved,'revenue',m.revenue,'averageTicket',case when m.approved>0 then round(m.revenue/m.approved,2) else null end),
 'clients',jsonb_build_object('total',coalesce((select customers from client_metrics),0),'new',(select new_clients from client_metrics),'recurring',(select recurring from client_metrics),'active',(select active from client_metrics),'retention',(select retention from client_metrics),'repurchase',(select repurchase from client_metrics),'ltv',(select ltv from client_metrics)),
 'payments',jsonb_build_object('approved',m.approved,'declined',m.declined,'pending',m.pending,'cancelled',m.cancelled,'refunds',(select count(*) from refunds),'chargebacks',m.chargebacks),
 'gateways',jsonb_build_object('count',(select count(distinct gateway_id) from attempts),'attempts',(select count(*) from attempts),'approved',(select count(*) from attempts where lower(coalesce(status,'')) in ('approved','success','succeeded','completed')),'failed',(select count(*) from attempts where lower(coalesce(status,'')) in ('failed','declined','rejected','error')),'approvalRate',case when (select count(*) from attempts)>0 then round((select count(*) from attempts where lower(coalesce(status,'')) in ('approved','success','succeeded','completed'))::numeric/(select count(*) from attempts)*100,1) else null end),
 'subscriptions',jsonb_build_object('available',true,'total',(select total from sub_metrics),'active',(select active from sub_metrics),'trialing',(select trialing from sub_metrics),'pastDue',(select past_due from sub_metrics),'paused',(select paused from sub_metrics),'canceled',(select canceled from sub_metrics),'mrr',(select mrr from sub_metrics),'arr',(select mrr*12 from sub_metrics)),
 'affiliates',jsonb_build_object('count',(select count(*) from public.affiliate_profiles where user_id=p_owner),'sales',coalesce((select count(*) from sales s where s.id in (select sale_id from public.affiliate_commissions ac where ac.user_id=p_owner and (p_product is null or ac.product_id=p_product))),0),'revenue',coalesce((select sum(s.amount) from sales s where s.id in (select sale_id from public.affiliate_commissions ac where ac.user_id=p_owner and (p_product is null or ac.product_id=p_product))),0),'commissions',coalesce((select sum(amount_distributed) from public.affiliate_commissions ac where ac.user_id=p_owner and (ac.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date and (p_product is null or ac.product_id=p_product)),0)),
 'marketing',jsonb_build_object('leads',(select count(*) from attribution),'sales',(select count(*) from sales where lower(coalesce(status,''))='approved'),'revenue',coalesce((select sum(amount) from sales where lower(coalesce(status,''))='approved'),0)),
 'crm',jsonb_build_object('conversations',(select count(*) from crm),'open',(select count(*) from crm where lower(coalesce(status,'')) in ('open','pending','waiting')),'unread',(select count(*) from crm where unread_count>0)),
 'operations',jsonb_build_object('events',(select count(*) from ops),'failed',(select count(*) from ops where lower(coalesce(status,'')) in ('failed','error','dead_letter')),'pending',(select count(*) from ops where processed_at is null)),
 'security',jsonb_build_object('events',(select count(*) from public.audit_logs a where a.organization_id=p_org and (a.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date),'authEvents',(select count(*) from public.audit_logs a where a.organization_id=p_org and (a.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date and (lower(coalesce(a.action,'')) like '%login%' or lower(coalesce(a.action,'')) like '%auth%'))),
 'alerts',jsonb_build_object('failedOperations',(select count(*) from ops where lower(coalesce(status,'')) in ('failed','error','dead_letter')),'gatewayFailures',(select count(*) from attempts where lower(coalesce(status,'')) in ('failed','declined','rejected','error')),'unreadCrm',(select count(*) from crm where unread_count>0),'disputes',(select count(*) from disputes_base),'subscriptionPastDue',(select past_due from sub_metrics)),
 'intelligence',jsonb_build_object('revenue',m.revenue,'sales',m.approved,'conversion',case when cm.visits>0 then round(cm.completed::numeric/cm.visits*100,1) else null end),
 'trend',(select points from series),'filters',(select * from filters),'measuredAt',now()
) from metrics m,prev_metrics pm,checkout_metrics cm;
$$;
revoke all on function private.dashboard_production_data_org(uuid,uuid,date,date,text,text,text,text,text,text,text,text) from public, anon, authenticated;

-- Same contract the dashboard already reads, now for the caller's current organization.
-- Members without can_view_values get every monetary figure as null (the screen shows N/D).
create or replace function public.dashboard_production_data_for_user_secure(p_start_date date,p_end_date date,p_product text default null,p_funnel text default null,p_gateway text default null,p_status text default null,p_source text default null,p_campaign text default null,p_currency text default null,p_payment_method text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_owner uuid;
  v_values boolean;
  v jsonb;
  v_trend jsonb;
  v_path text[];
begin
  if auth.uid() is null or v_org is null or not private.is_org_member(v_org) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date or p_end_date - p_start_date > 366 then raise exception 'INVALID_PERIOD' using errcode='22023'; end if;
  v_owner := private.organization_owner_id(v_org);
  v_values := private.has_org_capability(v_org, 'can_view_values');

  v := private.dashboard_production_data_org(v_org, v_owner, p_start_date, p_end_date, p_product, p_funnel, p_gateway, p_status, p_source, p_campaign, p_currency, p_payment_method);

  with days as (
    select d::date report_day from generate_series(p_start_date, p_end_date, '1 day'::interval) d
  ), sd as (
    select (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date report_day,
           coalesce(sum(s.amount) filter (where lower(coalesce(s.status,''))='approved'),0) revenue,
           count(*) filter (where lower(coalesce(s.status,''))='approved') sales
      from public.sales s
     where s.organization_id = v_org and (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
       and (p_product is null or s.product_id=p_product) and (p_funnel is null or s.funnel_id=p_funnel) and (p_gateway is null or s.gateway_id=p_gateway)
       and (p_status is null or lower(coalesce(s.status,''))=lower(p_status)) and (p_source is null or coalesce(s.source,s.attribution->>'source')=p_source)
       and (p_campaign is null or coalesce(s.campaign,s.attribution->>'campaign')=p_campaign) and (p_currency is null or lower(coalesce(s.currency,''))=lower(p_currency))
       and (p_payment_method is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method',''))=lower(p_payment_method))
     group by 1
  ), cd as (
    select (c.created_at at time zone 'America/Sao_Paulo')::date report_day, count(*) visits,
           count(*) filter (where c.completed_at is not null or lower(coalesce(c.status,'')) in ('completed','paid','approved')) completed
      from public.checkout_sessions c
     where c.organization_id = v_org and (c.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
       and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel) and (p_currency is null or lower(coalesce(c.currency,''))=lower(p_currency))
     group by 1
  )
  select jsonb_agg(jsonb_build_object('date',days.report_day,'revenue',case when v_values then coalesce(sd.revenue,0) end,'sales',coalesce(sd.sales,0),
                                      'checkoutVisits',coalesce(cd.visits,0),'checkoutCompleted',coalesce(cd.completed,0)) order by days.report_day)
    into v_trend
    from days left join sd on sd.report_day=days.report_day left join cd on cd.report_day=days.report_day;

  v := jsonb_set(v, '{trend}', coalesce(v_trend, '[]'::jsonb), true) || jsonb_build_object('can_view_values', v_values);
  if not v_values then
    foreach v_path slice 1 in array array[
      ['financial','revenue'],['financial','refundAmount'],['financial','disputeAmount'],['sales','averageTicket'],['previous','revenue'],
      ['funnels','revenue'],['products','revenue'],['products','averageTicket'],['clients','ltv'],['subscriptions','mrr'],['subscriptions','arr'],
      ['affiliates','revenue'],['affiliates','commissions'],['marketing','revenue'],['intelligence','revenue']
    ] loop
      if v #> v_path is not null then v := jsonb_set(v, v_path, 'null'::jsonb); end if;
    end loop;
  end if;
  return v;
end;
$function$;
revoke all on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) to authenticated;

-- Latest things that happened in the organization, newest first. Each source is gated like its own screen.
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
  v_values := private.has_org_capability(v_org, 'can_view_values');
  v_customers := private.has_org_capability(v_org, 'can_view_customers');
  v_chats := private.has_org_capability(v_org, 'can_view_chats');

  select coalesce(jsonb_agg(item order by (item->>'at')::timestamptz desc), '[]'::jsonb) into v
    from (
      select item from (
        (select jsonb_build_object('kind','payment','at',t.updated_at,'id',t.id,'status',t.status,
                 'amount',case when v_values then t.amount end,'currency',t.currency,'payment_method',t.metadata->>'payment_method',
                 'name',coalesce(t.customer->>'name',t.customer->>'full_name',t.customer->>'email')) as item
           from public.gateway_transactions t where t.organization_id = v_org order by t.updated_at desc limit v_limit)
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
    select t.status, t.funnel_id::text as funnel_id, t.product_id::text as product_id, t.gateway_id::text as gateway_id, t.amount, upper(coalesce(nullif(trim(t.currency), ''), 'BRL')) as currency
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
  product_rows as (
    select product_id, count(*) as total, count(*) filter (where status = 'approved') as approved,
           sum(amount) filter (where status = 'approved') as gross,
           count(distinct currency) filter (where status = 'approved') as currency_count,
           min(currency) filter (where status = 'approved') as currency
      from tx group by product_id
     order by approved desc, total desc
     limit 8
  ),
  gateway_rows as (
    select gateway_id, count(*) as total, count(*) filter (where status = 'approved') as approved,
           sum(amount) filter (where status = 'approved') as gross,
           count(distinct currency) filter (where status = 'approved') as currency_count,
           min(currency) filter (where status = 'approved') as currency
      from tx group by gateway_id
     order by approved desc, total desc
     limit 8
  ),
  leads as (
    -- customers first seen in the period (funnel, gateway or chat); funnel filter uses the funnel recorded on the customer
    select count(*) as new_customers
      from public.clients cl
     where cl.organization_id = v_org
       and cl.created_at >= v_since
       and (p_funnel_id is null or coalesce(cl.data->>'funnel_id', cl.data->>'last_funnel_id') = p_funnel_id)
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
    'by_product', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', r.product_id, 'name', coalesce(x.name, r.product_id), 'total', r.total, 'approved', r.approved,
        'gross', case when v_values and r.currency_count <= 1 then coalesce(r.gross, 0) end,
        'currency', r.currency, 'currency_count', r.currency_count
      ) order by r.approved desc, r.total desc)
        from product_rows r
        left join public.products x on x.id::text = r.product_id and x.organization_id = v_org
    ), '[]'::jsonb),
    'by_gateway', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gateway_id', r.gateway_id, 'name', x.display_name, 'total', r.total, 'approved', r.approved,
        'gross', case when v_values and r.currency_count <= 1 then coalesce(r.gross, 0) end,
        'currency', r.currency, 'currency_count', r.currency_count
      ) order by r.approved desc, r.total desc)
        from gateway_rows r
        left join public.gateways x on x.id::text = r.gateway_id and x.organization_id = v_org
    ), '[]'::jsonb),
    'leads', (select jsonb_build_object('new_customers', new_customers) from leads),
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
