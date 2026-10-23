-- Dashboard: realized vs pending money, filters that keep their options, binned test payments left out.
-- sales only ever holds approved rows (every projector inserts status 'approved'), so "pendentes" was always 0.
-- Realized/pending now come from gateway_transactions, the same ledger Pagamentos shows:
-- realized = approved, pending = created/pending (PIX/boleto issued and not paid yet).
-- Filter options were read from the already-filtered sales, so picking one value hid every other one
-- (and a period without sales had no options at all). They now come from the whole period, with names.
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
 and not exists(select 1 from public.gateway_transactions bt where bt.id=s.transaction_id and bt.deleted_at is not null)
),
-- Unfiltered period, for the filter options.
period_sales as (
 select s.* from public.sales s, params p
 where s.organization_id=p_org
 and ((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p.sd and p.ed)
),
period_ledger as (
 select t.* from public.gateway_transactions t, params p
 where t.organization_id=p_org and t.deleted_at is null
 and (t.created_at at time zone 'America/Sao_Paulo')::date between p.sd and p.ed
),
ledger as (
 select t.* from period_ledger t
 where (p_product is null or t.product_id::text=p_product)
 and (p_funnel is null or t.funnel_id::text=p_funnel)
 and (p_gateway is null or t.gateway_id::text=p_gateway)
 and (p_status is null or lower(coalesce(t.status,''))=lower(p_status))
 and (p_currency is null or lower(coalesce(t.currency,''))=lower(p_currency))
 and (p_payment_method is null or lower(coalesce(t.metadata->>'payment_method',''))=lower(p_payment_method))
),
ledger_metrics as (
 select coalesce(sum(amount) filter(where status='approved'),0) realized,
  count(*) filter(where status='approved') realized_count,
  coalesce(sum(amount) filter(where status in ('created','pending')),0) pending,
  count(*) filter(where status in ('created','pending')) pending_count
 from ledger
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
 and not exists(select 1 from public.gateway_transactions bt where bt.id=s.transaction_id and bt.deleted_at is not null)
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
 'product',coalesce((select jsonb_agg(jsonb_build_object('value',q.v,'label',coalesce(pr.name,q.v)) order by coalesce(pr.name,q.v)) from (select product_id::text v from period_sales union select product_id::text from period_ledger) q left join public.products pr on pr.id::text=q.v where q.v<>''),'[]'::jsonb),
 'funnel',coalesce((select jsonb_agg(jsonb_build_object('value',q.v,'label',coalesce(fu.nome,q.v)) order by coalesce(fu.nome,q.v)) from (select funnel_id::text v from period_sales union select funnel_id::text from period_ledger) q left join public.funnels fu on fu.id::text=q.v where q.v<>''),'[]'::jsonb),
 'gateway',coalesce((select jsonb_agg(jsonb_build_object('value',q.v,'label',coalesce(gw.display_name,q.v)) order by coalesce(gw.display_name,q.v)) from (select gateway_id::text v from period_ledger) q left join public.gateways gw on gw.id::text=q.v where q.v<>''),'[]'::jsonb),
 'status',coalesce((select jsonb_agg(v order by v) from (select distinct status v from period_ledger where status is not null and status<>'') q),'[]'::jsonb),
 'source',coalesce((select jsonb_agg(v order by v) from (select distinct source v from period_sales where source is not null and source<>'') q),'[]'::jsonb),
 'campaign',coalesce((select jsonb_agg(v order by v) from (select distinct campaign v from period_sales where campaign is not null and campaign<>'') q),'[]'::jsonb),
 'currency',coalesce((select jsonb_agg(v order by v) from (select upper(currency) v from period_sales where coalesce(currency,'')<>'' union select upper(currency) from period_ledger where coalesce(currency,'')<>'') q),'[]'::jsonb),
 'payment_method',coalesce((select jsonb_agg(v order by v) from (select lower(coalesce(data->>'payment_method',data->>'payment_type',data->>'method')) v from period_sales where coalesce(data->>'payment_method',data->>'payment_type',data->>'method') is not null union select lower(metadata->>'payment_method') from period_ledger where metadata->>'payment_method' is not null) q),'[]'::jsonb))
)
select jsonb_build_object(
 'period',jsonb_build_object('start',p_start_date,'end',p_end_date,'previousStart',(select prev_sd from params),'previousEnd',(select prev_ed from params)),
 'financial',jsonb_build_object('revenue',m.revenue,'approved',m.approved,'pending',lm.pending_count,'realized',lm.realized,'realizedCount',lm.realized_count,'pendingAmount',lm.pending,'realizedShare',case when lm.realized+lm.pending>0 then round(lm.realized/(lm.realized+lm.pending)*100,1) end,'pendingShare',case when lm.realized+lm.pending>0 then round(lm.pending/(lm.realized+lm.pending)*100,1) end,'refunds',(select count(*) from refunds),'refundAmount',coalesce((select sum(amount) from refunds),0),'disputes',(select count(*) from disputes_base),'disputeAmount',coalesce((select sum(amount) from disputes_base),0)),
 'sales',jsonb_build_object('total',m.total,'approved',m.approved,'pending',lm.pending_count,'declined',m.declined,'cancelled',m.cancelled,'refunded',m.refunded,'chargebacks',m.chargebacks,'averageTicket',case when m.approved>0 then round(m.revenue/m.approved,2) else null end),
 'previous',jsonb_build_object('revenue',pm.revenue,'sales',pm.approved,'totalSales',pm.total,'conversion',case when (select visits from prev_checkout_metrics)>0 then round((select completed from prev_checkout_metrics)::numeric/(select visits from prev_checkout_metrics)*100,1) else null end),
 'checkouts',jsonb_build_object('visits',cm.visits,'started',cm.started,'completed',cm.completed,'abandoned',cm.abandoned,'conversion',case when cm.visits>0 then round(cm.completed::numeric/cm.visits*100,1) else null end),
 'funnels',jsonb_build_object('total',(select count(*) from public.funnels f where f.organization_id=p_org and f.deleted_at is null and (p_funnel is null or f.id=p_funnel)),'visits',(select count(*) from attribution),'leads',(select count(*) from attribution),'sales',m.approved,'revenue',m.revenue),
 'products',jsonb_build_object('sales',m.approved,'revenue',m.revenue,'averageTicket',case when m.approved>0 then round(m.revenue/m.approved,2) else null end),
 'clients',jsonb_build_object('total',coalesce((select customers from client_metrics),0),'new',(select new_clients from client_metrics),'recurring',(select recurring from client_metrics),'active',(select active from client_metrics),'retention',(select retention from client_metrics),'repurchase',(select repurchase from client_metrics),'ltv',(select ltv from client_metrics)),
 'payments',jsonb_build_object('approved',lm.realized_count,'declined',(select count(*) from ledger where status in ('failed','declined')),'pending',lm.pending_count,'cancelled',m.cancelled,'refunds',(select count(*) from refunds),'chargebacks',m.chargebacks),
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
) from metrics m,prev_metrics pm,checkout_metrics cm,ledger_metrics lm;
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
  -- Attendants (customer service only) never read payments or financial figures.
  if private.has_org_role(v_org, array['attendant']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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
       and not exists(select 1 from public.gateway_transactions bt where bt.id=s.transaction_id and bt.deleted_at is not null)
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
      ['financial','revenue'],['financial','realized'],['financial','pendingAmount'],['financial','realizedShare'],['financial','pendingShare'],['financial','refundAmount'],['financial','disputeAmount'],['sales','averageTicket'],['previous','revenue'],
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
