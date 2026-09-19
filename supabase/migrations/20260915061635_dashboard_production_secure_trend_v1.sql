create or replace function public.dashboard_production_data_for_user_secure(p_start_date date,p_end_date date,p_product text default null,p_funnel text default null,p_gateway text default null,p_status text default null,p_source text default null,p_campaign text default null,p_currency text default null,p_payment_method text default null) returns jsonb language sql stable security invoker set search_path=public as $$
with base as (
 select public.dashboard_production_data_for_user(p_start_date,p_end_date,p_product,p_funnel,p_gateway,p_status,p_source,p_campaign,p_currency,p_payment_method) payload
), days as (
 select d::date report_day from generate_series(p_start_date,p_end_date,'1 day'::interval) d
), sd as (
 select (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date report_day,
 coalesce(sum(s.amount) filter(where lower(coalesce(s.status,''))='approved'),0) revenue,
 count(*) filter(where lower(coalesce(s.status,''))='approved') sales
 from public.sales s
 where s.user_id=auth.uid() and (coalesce(s.occurred_at,s.created_at) at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
 and (p_product is null or s.product_id=p_product) and (p_funnel is null or s.funnel_id=p_funnel) and (p_gateway is null or s.gateway_id=p_gateway)
 and (p_status is null or lower(coalesce(s.status,''))=lower(p_status)) and (p_source is null or coalesce(s.source,s.attribution->>'source')=p_source)
 and (p_campaign is null or coalesce(s.campaign,s.attribution->>'campaign')=p_campaign) and (p_currency is null or lower(coalesce(s.currency,''))=lower(p_currency))
 and (p_payment_method is null or lower(coalesce(s.data->>'payment_method',s.data->>'payment_type',s.data->>'method',''))=lower(p_payment_method))
 group by 1
), cd as (
 select (c.created_at at time zone 'America/Sao_Paulo')::date report_day,count(*) visits,
 count(*) filter(where c.completed_at is not null or lower(coalesce(c.status,'')) in ('completed','paid','approved')) completed
 from public.checkout_sessions c
 where c.user_id=auth.uid() and (c.created_at at time zone 'America/Sao_Paulo')::date between p_start_date and p_end_date
 and (p_product is null or c.product_id=p_product) and (p_funnel is null or c.funnel_id=p_funnel) and (p_currency is null or lower(coalesce(c.currency,''))=lower(p_currency))
 group by 1
), trend as (
 select jsonb_agg(jsonb_build_object('date',days.report_day,'revenue',coalesce(sd.revenue,0),'sales',coalesce(sd.sales,0),'checkoutVisits',coalesce(cd.visits,0),'checkoutCompleted',coalesce(cd.completed,0)) order by days.report_day) points
 from days left join sd on sd.report_day=days.report_day left join cd on cd.report_day=days.report_day
)
select jsonb_set(base.payload,'{trend}',coalesce(trend.points,'[]'::jsonb),true) from base cross join trend;
$$;
revoke all on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) from public;
grant execute on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) to authenticated;