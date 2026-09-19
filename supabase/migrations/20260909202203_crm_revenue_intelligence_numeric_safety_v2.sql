begin;
create or replace function public.crm_revenue_intelligence(p_days integer default 30)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_days integer := greatest(1,least(coalesce(p_days,30),365)); v jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  with ss as (
    select s.* from public.sales s where s.user_id=v_user and coalesce(s.occurred_at,s.created_at)>=timezone('utc',now())-(v_days||' days')::interval
  ), ee as (
    select e.* from public.crm_webhook_events e where e.user_id=v_user and e.received_at>=timezone('utc',now())-(v_days||' days')::interval
  ), raw_events as (
    select e.*, coalesce(
      case when e.payload->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (e.payload->>'amount')::numeric end,
      case when e.payload->'data'->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (e.payload->'data'->>'amount')::numeric end,
      case when e.payload->'transaction'->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (e.payload->'transaction'->>'amount')::numeric end,
      0
    ) amount
    from ee e
  ), failed as (
    select * from raw_events where lower(status) in ('failed','declined','rejected','refused','error','canceled','cancelled','expired')
  ), pending as (
    select * from raw_events where lower(status) in ('pending','waiting','processing','awaiting_payment')
  ), funnel_loss as (
    select coalesce(nullif(payload->>'funnel_id',''),'sem funil') key,count(*)::int events,coalesce(sum(amount),0)::numeric amount from failed group by 1 order by amount desc limit 10
  ), gateway_loss as (
    select coalesce(nullif(coalesce(payload->>'gateway_id',payload->'gateway'->>'id'),''),'gateway não informado') key,count(*)::int events,coalesce(sum(amount),0)::numeric amount from failed group by 1 order by amount desc limit 10
  ), recent as (
    select jsonb_agg(jsonb_build_object('event_id',x.id,'customer',coalesce(x.buyer_name,x.buyer_email,'Cliente'),'email',x.buyer_email,'status',x.status,'amount',x.amount,'reason',x.error_reason,'transaction_id',x.transaction_id,'received_at',x.received_at) order by x.received_at desc) items from (select * from failed order by received_at desc limit 25) x
  ), metrics as (
    select
      (select count(*) from ss)::int sales_count,
      (select coalesce(sum(amount),0) from ss where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded'))::numeric approved_revenue,
      (select count(*) from ss where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded'))::int approved_sales,
      (select count(*) from ee)::int events_count,
      (select count(*) from failed)::int failed_count,
      (select count(*) from pending)::int pending_count,
      (select coalesce(sum(amount),0) from failed)::numeric failed_value,
      (select coalesce(sum(amount),0) from pending)::numeric pending_value,
      (select count(*) from public.crm_conversations c where c.user_id=v_user and c.unread_count>0)::int unread_conversations,
      (select count(*) from public.crm_conversations c where c.user_id=v_user and c.status='open')::int open_conversations,
      (select public.althea_pay_calculate_tmr(v_user))::numeric tmr_seconds
  )
  select jsonb_build_object('window_days',v_days,'metrics',(select to_jsonb(metrics) from metrics),'loss_by_funnel',coalesce((select jsonb_agg(to_jsonb(f)) from funnel_loss f),'[]'::jsonb),'loss_by_gateway',coalesce((select jsonb_agg(to_jsonb(g)) from gateway_loss g),'[]'::jsonb),'recent_recovery_signals',coalesce((select items from recent),'[]'::jsonb),'generated_at',timezone('utc',now())) into v;
  return v;
end;
$$;
commit;