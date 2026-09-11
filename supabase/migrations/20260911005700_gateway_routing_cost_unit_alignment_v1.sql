begin;

create or replace function public.rank_gateway_candidates(
  p_user_id uuid,
  p_gateway_ids text[],
  p_amount numeric,
  p_currency text,
  p_environment text,
  p_card_brand text
) returns table(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
with requested as (select distinct x gateway_id from unnest(p_gateway_ids) x),
exact_overrides as (
 select o.forced_gateway_id gateway_id
 from public.gateway_routing_overrides o
 where o.user_id=p_user_id and o.active=true and o.expires_at>clock_timestamp()
   and o.forced_gateway_id in (select gateway_id from requested)
   and (select count(*) from public.gateway_routing_overrides z where z.user_id=p_user_id and z.active=true and z.expires_at>clock_timestamp() and z.forced_gateway_id in (select gateway_id from requested))=1
),
split_matches as (
 select s.allocations from public.gateway_routing_split_policies s
 where s.user_id=p_user_id and s.active=true
   and (select count(*) from jsonb_array_elements(s.allocations))=(select count(*) from requested)
   and not exists(select 1 from requested r where not exists(select 1 from jsonb_array_elements(s.allocations) a where coalesce(a->>'gateway_id',a->>'gatewayId')=r.gateway_id))
   and not exists(select 1 from jsonb_array_elements(s.allocations) a where not exists(select 1 from requested r where r.gateway_id=coalesce(a->>'gateway_id',a->>'gatewayId')))
 limit 1
),
eligible as (
 select g.id::text gateway_id,g.capabilities,coalesce(h.is_healthy,true) healthy,coalesce(h.latency_ms,0) latency_ms,coalesce(h.circuit_state,'closed') circuit_state,case when coalesce(h.circuit_state,'closed')='open' then 0 else 1 end circuit_ok
 from public.gateways g left join lateral (select hs.is_healthy,hs.latency_ms,hs.circuit_state from public.gateway_health_snapshots hs where hs.gateway_id=g.circuit_id order by hs.checked_at desc limit 1) h on true
 where g.user_id=p_user_id and g.id::text=any(p_gateway_ids) and lower(g.status) in ('connected','degraded') and lower(g.environment)=lower(p_environment)
   and (g.capabilities->'currencies' is null or jsonb_typeof(g.capabilities->'currencies')<>'array' or g.capabilities->'currencies' @> to_jsonb(upper(p_currency)))
   and (g.capabilities->>'min_amount' is null or g.capabilities->>'min_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount >= (g.capabilities->>'min_amount')::numeric)
   and (g.capabilities->>'max_amount' is null or g.capabilities->>'max_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount <= (g.capabilities->>'max_amount')::numeric)
),
attempts as (
 select e.gateway_id,count(*) filter(where a.status in ('approved','declined','pending','error'))::numeric total,count(*) filter(where a.status='approved')::numeric approved
 from eligible e left join public.gateway_payment_attempts a on a.gateway_id=e.gateway_id and a.user_id=p_user_id and a.created_at>=clock_timestamp()-interval '30 days' group by e.gateway_id
),
costs as (
 select e.gateway_id,coalesce(public.gateway_effective_cost_bps(p_user_id,e.gateway_id,p_card_brand,p_amount),case when e.capabilities->>'cost_bps' ~ '^[0-9]+(\\.[0-9]+)?$' then (e.capabilities->>'cost_bps')::numeric else 0 end) cost_bps from eligible e
),
scored as (
 select e.gateway_id,round((e.circuit_ok*100.0)+(case when e.healthy then 25 else -35 end)+(case when e.latency_ms<=0 then 10 when e.latency_ms<=200 then 10 when e.latency_ms<=500 then 6 when e.latency_ms<=1000 then 2 else -10 end)+(case when coalesce(a.total,0)=0 then 8 else greatest(-15,least(20,((a.approved/nullif(a.total,0))*20)-5)) end)-(least(15,c.cost_bps/100.0)),4) base_score,case when coalesce(a.total,0)=0 then 1 else round((a.approved/nullif(a.total,0))*100,4) end approval_rate,e.latency_ms,e.healthy,e.circuit_state,c.cost_bps from eligible e left join attempts a on a.gateway_id=e.gateway_id left join costs c on c.gateway_id=e.gateway_id
),
weighted as (
 select s.*,coalesce((select (a->>'weight')::numeric/100 from split_matches sm cross join lateral jsonb_array_elements(sm.allocations) a where coalesce(a->>'gateway_id',a->>'gatewayId')=s.gateway_id),1) weight,case when exists(select 1 from exact_overrides) then case when s.gateway_id=(select gateway_id from exact_overrides limit 1) then 1 else 0 end else 1 end forced_ok from scored s
)
select gateway_id,round(base_score*weight,4),approval_rate,latency_ms,healthy,circuit_state,cost_bps from weighted where circuit_state<>'open' and forced_ok=1 order by routing_score desc,gateway_id asc;
$function$;

commit;
