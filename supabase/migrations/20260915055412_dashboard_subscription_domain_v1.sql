create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id text,
  product_id text,
  funnel_id text,
  gateway_id text,
  transaction_id uuid,
  provider_subscription_id text,
  status text not null default 'active' check (status in ('trialing','active','past_due','paused','canceled','expired')),
  billing_interval text not null default 'month' check (billing_interval in ('day','week','month','year')),
  interval_count integer not null default 1 check (interval_count > 0),
  amount numeric not null default 0 check (amount >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_customer_tenant_fk foreign key (user_id, customer_id) references public.clients(user_id, id),
  constraint subscriptions_product_fk foreign key (product_id) references public.products(id),
  constraint subscriptions_funnel_fk foreign key (funnel_id) references public.funnels(id),
  constraint subscriptions_gateway_fk foreign key (gateway_id) references public.gateways(id),
  constraint subscriptions_transaction_fk foreign key (transaction_id) references public.gateway_transactions(id)
);

create unique index if not exists subscriptions_provider_identity_uidx on public.subscriptions(user_id, provider_subscription_id) where provider_subscription_id is not null;
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists subscriptions_user_period_idx on public.subscriptions(user_id, current_period_end);
create index if not exists subscriptions_user_created_idx on public.subscriptions(user_id, created_at);

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own on public.subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists subscriptions_update_own on public.subscriptions;
create policy subscriptions_update_own on public.subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event_type text not null check (event_type in ('created','trial_started','activated','renewed','past_due','paused','resumed','canceled','expired','payment_failed','payment_recovered')),
  from_status text,
  to_status text,
  amount numeric check (amount is null or amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists subscription_events_provider_uidx on public.subscription_events(user_id, provider_event_id) where provider_event_id is not null;
create index if not exists subscription_events_subscription_time_idx on public.subscription_events(subscription_id, occurred_at desc);
create index if not exists subscription_events_user_time_idx on public.subscription_events(user_id, occurred_at desc);
alter table public.subscription_events enable row level security;
drop policy if exists subscription_events_select_own on public.subscription_events;
create policy subscription_events_select_own on public.subscription_events for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists subscription_events_insert_own on public.subscription_events;
create policy subscription_events_insert_own on public.subscription_events for insert to authenticated with check (user_id = (select auth.uid()));

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
) returns jsonb language sql stable set search_path = public as $function$
with sales_base as (
 select s.* from public.sales s
 where s.user_id=(select auth.uid())
 and ((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
 and (p_product is null or s.product_id=p_product)
 and (p_funnel is null or s.funnel_id=p_funnel)
 and (p_gateway is null or s.gateway_id=p_gateway)
 and (p_status is null or lower(coalesce(s.status,''))=lower(p_status))
 and (p_source is null or coalesce(s.source,s.attribution->>'source')=p_source)
 and (p_campaign is null or coalesce(s.campaign,s.attribution->>'campaign')=p_campaign)
 and (p_currency is null or lower(coalesce(s.currency,''))=lower(p_currency))
 and (p_payment_method is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method',''))=lower(p_payment_method))
),
checkout_base as (
 select c.* from public.checkout_sessions c where c.user_id=(select auth.uid())
 and ((c.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
 and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel)
 and (p_currency is null or lower(coalesce(c.currency,''))=lower(p_currency))
),
sales_counts as (
 select count(*) total,
 count(*) filter(where lower(coalesce(status,''))='approved') approved,
 count(*) filter(where lower(coalesce(status,'')) in ('pending','processing')) pending,
 count(*) filter(where lower(coalesce(status,'')) in ('declined','failed','rejected')) declined,
 count(*) filter(where lower(coalesce(status,'')) in ('cancelled','canceled')) cancelled,
 count(*) filter(where lower(coalesce(status,''))='refunded') refunded,
 count(*) filter(where lower(coalesce(status,''))='chargeback') chargebacks,
 coalesce(sum(amount) filter(where lower(coalesce(status,''))='approved'),0) revenue
 from sales_base
),
checkout_counts as (
 select count(*) visits,
 count(*) filter(where lower(coalesce(status,'')) in ('started','pending','processing')) started,
 count(*) filter(where completed_at is not null or lower(coalesce(status,'')) in ('completed','paid','approved')) completed,
 count(*) filter(where abandoned_at is not null or lower(coalesce(status,''))='abandoned') abandoned from checkout_base
),
refund_base as (
 select count(*) refunds, coalesce(sum(amount),0) amount from public.gateway_refunds
 where user_id=(select auth.uid()) and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
dispute_base as (
 select count(*) disputes, coalesce(sum(amount),0) amount from public.disputes
 where user_id=(select auth.uid()) and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
gateway_base as (
 select count(distinct gateway_id) gateways,count(*) attempts,
 count(*) filter(where lower(coalesce(status,'')) in ('approved','success','succeeded','completed')) approved,
 count(*) filter(where lower(coalesce(status,'')) in ('failed','declined','rejected','error')) failed
 from public.gateway_payment_attempts where user_id=(select auth.uid())
 and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
crm_base as (
 select count(*) conversations,count(*) filter(where unread_count>0) unread,
 count(*) filter(where lower(coalesce(status,'')) in ('open','pending','waiting')) open
 from public.crm_conversations where user_id=(select auth.uid())
 and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
ops_base as (
 select count(*) events,count(*) filter(where lower(coalesce(status,'')) in ('failed','error','dead_letter')) failed,
 count(*) filter(where processed_at is null) pending from public.integration_events where user_id=(select auth.uid())
 and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
security_base as (
 select count(*) events,count(*) filter(where lower(coalesce(action,'')) like '%login%' or lower(coalesce(action,'')) like '%auth%') auth_events
 from public.audit_logs where user_id=(select auth.uid()) and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)
),
affiliate_base as (select count(*) affiliates from public.affiliate_profiles where user_id=(select auth.uid())),
commissions as (select coalesce(sum(amount_distributed),0) amount from public.affiliate_commissions where user_id=(select auth.uid()) and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)),
client_sales as (
 select coalesce(nullif(s.data->>'customer_id',''),nullif(s.data->>'customer_email',''),nullif(s.data->>'email',''),s.id) customer_key,
        count(*) sales_count, max((coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date) last_sale_date,
        sum(s.amount) revenue
 from sales_base s where lower(coalesce(s.status,''))='approved'
 group by 1
),
clients_base as (select count(*) total from public.clients where user_id=(select auth.uid()) and ((created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)),
client_metrics as (
 select (select total from clients_base) total,
        count(*) filter(where cs.sales_count=1) new_clients,
        count(*) filter(where cs.sales_count>1) recurring_clients,
        count(*) active_clients,
        case when count(*)>0 then round(count(*) filter(where cs.sales_count>1)::numeric/count(*)*100,1) else 0 end repurchase,
        case when count(*)>0 then round(count(*) filter(where cs.last_sale_date between p_start_date and p_end_date)::numeric/count(*)*100,1) else 0 end retention,
        case when count(*)>0 then round(sum(cs.revenue)/count(*),2) else 0 end ltv
 from client_sales cs
),
subscription_base as (
 select * from public.subscriptions s where s.user_id=(select auth.uid())
 and (p_product is null or s.product_id=p_product) and (p_funnel is null or s.funnel_id=p_funnel)
 and (p_gateway is null or s.gateway_id=p_gateway) and (p_currency is null or lower(s.currency)=lower(p_currency))
 and ((s.created_at at time zone 'America/Sao_Paulo')::date <= p_end_date)
),
subscription_metrics as (
 select count(*) filter(where status in ('trialing','active','past_due','paused') and (ended_at is null or ended_at::date > p_end_date)) active,
        count(*) filter(where status='trialing') trialing,
        count(*) filter(where status='past_due') past_due,
        count(*) filter(where status='paused') paused,
        count(*) filter(where status='canceled' and ((coalesce(canceled_at,ended_at,updated_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)) canceled,
        count(*) total,
        coalesce(sum(case when status in ('trialing','active','past_due','paused') and (ended_at is null or ended_at::date > p_end_date) then case when billing_interval='month' then amount/nullif(interval_count,0) when billing_interval='year' then amount/(12*nullif(interval_count,0)) when billing_interval='week' then amount*52/(12*nullif(interval_count,0)) when billing_interval='day' then amount*365/(12*nullif(interval_count,0)) else 0 end else 0 end),0) mrr
 from subscription_base
),
filter_options as (
 select
 coalesce((select jsonb_agg(v order by v) from (select distinct product_id v from sales_base where product_id is not null and product_id<>'') q),'[]'::jsonb) products,
 coalesce((select jsonb_agg(v order by v) from (select distinct funnel_id v from sales_base where funnel_id is not null and funnel_id<>'') q),'[]'::jsonb) funnels,
 coalesce((select jsonb_agg(v order by v) from (select distinct gateway_id v from sales_base where gateway_id is not null and gateway_id<>'') q),'[]'::jsonb) gateways,
 coalesce((select jsonb_agg(v order by v) from (select distinct status v from sales_base where status is not null and status<>'') q),'[]'::jsonb) statuses,
 coalesce((select jsonb_agg(v order by v) from (select distinct currency v from sales_base where currency is not null and currency<>'') q),'[]'::jsonb) currencies,
 coalesce((select jsonb_agg(v order by v) from (select distinct coalesce(source,attribution->>'source') v from sales_base where coalesce(source,attribution->>'source') is not null and coalesce(source,attribution->>'source')<>'') q),'[]'::jsonb) sources,
 coalesce((select jsonb_agg(v order by v) from (select distinct coalesce(campaign,attribution->>'campaign') v from sales_base where coalesce(campaign,attribution->>'campaign') is not null and coalesce(campaign,attribution->>'campaign')<>'') q),'[]'::jsonb) campaigns,
 coalesce((select jsonb_agg(v order by v) from (select distinct lower(coalesce(data->>'payment_method',data->>'payment_type',data->>'method')) v from sales_base where coalesce(data->>'payment_method',data->>'payment_type',data->>'method') is not null) q),'[]'::jsonb) payment_methods
)
select jsonb_build_object(
 'financial',jsonb_build_object('revenue',sc.revenue,'approved',sc.approved,'pending',sc.pending,'refunds',rb.refunds,'refundAmount',rb.amount,'disputes',db.disputes,'disputeAmount',db.amount),
 'sales',jsonb_build_object('total',sc.total,'approved',sc.approved,'pending',sc.pending,'declined',sc.declined,'cancelled',sc.cancelled,'refunded',sc.refunded,'chargebacks',sc.chargebacks,'averageTicket',case when sc.approved>0 then round(sc.revenue/sc.approved,2) else 0 end),
 'funnels',jsonb_build_object('total',(select count(*) from public.funnels where user_id=(select auth.uid()) and deleted_at is null),'visits',cc.visits,'leads',(select count(*) from public.attribution_sessions a where a.user_id=(select auth.uid()) and ((a.first_seen_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)),'sales',sc.approved,'revenue',sc.revenue),
 'checkouts',jsonb_build_object('visits',cc.visits,'started',cc.started,'completed',cc.completed,'abandoned',cc.abandoned,'conversion',case when cc.visits>0 then round(cc.completed::numeric/cc.visits*100,1) else 0 end),
 'products',jsonb_build_object('sales',sc.approved,'revenue',sc.revenue,'averageTicket',case when sc.approved>0 then round(sc.revenue/sc.approved,2) else 0 end),
 'clients',jsonb_build_object('total',cm.total,'new',cm.new_clients,'recurring',cm.recurring_clients,'active',cm.active_clients,'retention',cm.retention,'repurchase',cm.repurchase,'ltv',cm.ltv),
 'payments',jsonb_build_object('approved',sc.approved,'declined',sc.declined,'pending',sc.pending,'cancelled',sc.cancelled,'refunds',rb.refunds,'chargebacks',sc.chargebacks),
 'gateways',jsonb_build_object('count',gb.gateways,'attempts',gb.attempts,'approved',gb.approved,'failed',gb.failed,'approvalRate',case when gb.attempts>0 then round(gb.approved::numeric/gb.attempts*100,1) else 0 end),
 'subscriptions',jsonb_build_object('available',true,'total',sm.total,'active',sm.active,'trialing',sm.trialing,'pastDue',sm.past_due,'paused',sm.paused,'canceled',sm.canceled,'mrr',sm.mrr,'arr',sm.mrr*12),
 'affiliates',jsonb_build_object('count',(select affiliates from affiliate_base),'sales',sc.approved,'revenue',sc.revenue,'commissions',(select amount from commissions)),
 'marketing',jsonb_build_object('leads',(select count(*) from public.attribution_sessions a where a.user_id=(select auth.uid()) and ((a.first_seen_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date)),'sales',sc.approved,'revenue',sc.revenue),
 'crm',jsonb_build_object('conversations',cr.conversations,'unread',cr.unread,'open',cr.open),
 'operations',jsonb_build_object('events',op.events,'failed',op.failed,'pending',op.pending),
 'security',jsonb_build_object('events',se.events,'authEvents',se.auth_events),
 'activity',jsonb_build_object('events',se.events),
 'alerts',jsonb_build_object('failedOperations',op.failed,'gatewayFailures',gb.failed,'unreadCrm',cr.unread,'disputes',db.disputes,'subscriptionPastDue',sm.past_due),
 'intelligence',jsonb_build_object('revenue',sc.revenue,'sales',sc.approved,'conversion',case when cc.visits>0 then round(cc.completed::numeric/cc.visits*100,1) else 0 end),
 'filters',(select to_jsonb(f) from filter_options f),'measuredAt',now()
) from sales_counts sc,checkout_counts cc,refund_base rb,dispute_base db,gateway_base gb,crm_base cr,ops_base op,security_base se,client_metrics cm,subscription_metrics sm;
$function$;
revoke all on function public.dashboard_operational_data_for_user(date,date,text,text,text,text,text,text,text,text) from public;
grant execute on function public.dashboard_operational_data_for_user(date,date,text,text,text,text,text,text,text,text) to authenticated;