alter table public.gateway_payment_attempts alter column gateway_id type text using gateway_id::text;

alter table public.gateway_payment_attempts drop constraint if exists gateway_payment_attempts_gateway_id_fkey;
alter table public.gateway_payment_attempts add constraint gateway_payment_attempts_gateway_id_fkey foreign key (gateway_id) references public.gateways(id);

create index if not exists idx_gateway_payment_attempts_tenant_gateway on public.gateway_payment_attempts(user_id,gateway_id,created_at desc);

create or replace function public.gateway_attempt_gateway_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.gateway_id is null or btrim(new.gateway_id)='' then raise exception 'gateway_attempt_gateway_id_required'; end if;
  if not exists (select 1 from public.gateways g where g.id=new.gateway_id and g.user_id=new.user_id) then raise exception 'gateway_attempt_gateway_tenant_mismatch'; end if;
  return new;
end;
$$;
revoke all on function public.gateway_attempt_gateway_tenant_integrity() from public,anon,authenticated;
grant execute on function public.gateway_attempt_gateway_tenant_integrity() to service_role;
drop trigger if exists trg_gateway_attempt_gateway_tenant_integrity on public.gateway_payment_attempts;
create trigger trg_gateway_attempt_gateway_tenant_integrity before insert or update of gateway_id,user_id on public.gateway_payment_attempts for each row execute function public.gateway_attempt_gateway_tenant_integrity();

create or replace function public.rank_gateway_candidates(p_user_id uuid,p_gateway_ids text[],p_amount numeric,p_currency text,p_environment text)
returns table(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
language sql security definer set search_path=public
as $$
with eligible as (
 select g.id::text gateway_id,g.capabilities,g.environment,coalesce(h.is_healthy,true) healthy,coalesce(h.latency_ms,0) latency_ms,coalesce(h.circuit_state,'closed') circuit_state,case when coalesce(h.circuit_state,'closed')='open' then 0 else 1 end circuit_ok
 from public.gateways g left join lateral (select hs.is_healthy,hs.latency_ms,hs.circuit_state from public.gateway_health_snapshots hs where hs.gateway_id=g.circuit_id order by hs.checked_at desc limit 1) h on true
 where g.user_id=p_user_id and g.id::text=any(p_gateway_ids) and lower(g.status) in ('connected','degraded') and lower(g.environment)=lower(p_environment)
 and (g.capabilities->'currencies' is null or jsonb_typeof(g.capabilities->'currencies')<>'array' or g.capabilities->'currencies' @> to_jsonb(upper(p_currency)))
 and (g.capabilities->>'min_amount' is null or g.capabilities->>'min_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount >= (g.capabilities->>'min_amount')::numeric)
 and (g.capabilities->>'max_amount' is null or g.capabilities->>'max_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount <= (g.capabilities->>'max_amount')::numeric)
),attempts as (
 select e.gateway_id,count(*) filter(where a.status in ('approved','declined','pending','error'))::numeric total,count(*) filter(where a.status='approved')::numeric approved
 from eligible e left join public.gateway_payment_attempts a on a.gateway_id=e.gateway_id and a.user_id=p_user_id and a.created_at>=now()-interval '30 days' group by e.gateway_id
),scored as (
 select e.gateway_id,round((e.circuit_ok*100.0)+(case when e.healthy then 25 else -35 end)+(case when e.latency_ms<=0 then 10 when e.latency_ms<=200 then 10 when e.latency_ms<=500 then 6 when e.latency_ms<=1000 then 2 else -10 end)+(case when coalesce(a.total,0)=0 then 8 else greatest(-15,least(20,((a.approved/nullif(a.total,0))*20)-5)) end)-(case when e.capabilities->>'cost_bps'~'^[0-9]+(\\.[0-9]+)?$' then least(15,(e.capabilities->>'cost_bps')::numeric/100.0) else 0 end),4) routing_score,case when coalesce(a.total,0)=0 then 1 else round((a.approved/nullif(a.total,0))*100,4) end approval_rate,e.latency_ms,e.healthy,e.circuit_state,case when e.capabilities->>'cost_bps'~'^[0-9]+(\\.[0-9]+)?$' then (e.capabilities->>'cost_bps')::numeric else 0 end cost_bps
 from eligible e left join attempts a on a.gateway_id=e.gateway_id
)
select gateway_id,routing_score,approval_rate,latency_ms,healthy,circuit_state,cost_bps from scored where circuit_state<>'open' order by routing_score desc,gateway_id asc;
$$;
revoke all on function public.rank_gateway_candidates(uuid,text[],numeric,text,text) from public,anon,authenticated;
grant execute on function public.rank_gateway_candidates(uuid,text[],numeric,text,text) to service_role;
