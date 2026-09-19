drop function if exists public.crm_recovery_opportunities(integer);

create function public.crm_recovery_opportunities(p_days integer default 7)
returns table(
  event_id uuid,
  received_at timestamp with time zone,
  status text,
  transaction_id text,
  buyer_name text,
  buyer_email text,
  funnel_id text,
  product_id text,
  amount numeric,
  currency text,
  priority integer,
  opportunity_type text,
  next_action text,
  conversation_id uuid,
  context_status text
)
language sql
stable
set search_path to 'public'
as $function$
with raw as (
 select e.id event_id,e.received_at,lower(coalesce(e.status,'')) event_status,e.transaction_id,e.buyer_name,e.buyer_email,
 nullif(coalesce(e.payload->>'funnel_id',e.payload->>'funnelId'),'') funnel_id,
 nullif(coalesce(e.payload->>'product_id',e.payload->>'productId'),'') product_id,
 coalesce(e.payload->>'amount',e.payload->>'value',e.payload->>'total',e.payload->'payment'->>'amount',e.payload->'transaction'->>'amount') amount_text,
 coalesce(e.payload->>'currency',e.payload->'payment'->>'currency','BRL') currency,e.processed_at
 from public.crm_webhook_events e where e.user_id=auth.uid() and e.received_at>=now()-make_interval(days=>greatest(1,least(coalesce(p_days,7),30))) and lower(coalesce(e.status,'')) in ('failed','declined','pending','abandoned','waiting','created')
), base as (
 select r.*,case when r.amount_text ~ '^[+-]?[0-9]+([.,][0-9]+)?$' then replace(r.amount_text,',','.')::numeric else null end amount from raw r
), scored as (
 select b.*,case when b.event_status in ('failed','declined') then 60 when b.event_status in ('pending','waiting') then 50 else 40 end + case when b.amount is not null and b.amount>=500 then 20 when b.amount is not null and b.amount>=100 then 10 else 0 end + case when b.buyer_email is not null then 5 else 0 end + case when b.received_at>=now()-interval '30 minutes' then 15 when b.received_at>=now()-interval '6 hours' then 10 when b.received_at>=now()-interval '24 hours' then 5 else 0 end priority from base b
), linked as (
 select s.*,
   (select array_agg(c.id) from public.crm_conversations c
    where c.user_id = auth.uid()
      and s.transaction_id is not null
      and c.transaction_id = s.transaction_id
   ) as candidate_ids
 from scored s
)
select l.event_id,l.received_at,l.event_status,l.transaction_id,l.buyer_name,l.buyer_email,l.funnel_id,l.product_id,l.amount,l.currency,least(100,l.priority)::integer,
case when l.event_status in ('failed','declined') then 'payment_failed' when l.event_status in ('pending','waiting') then 'payment_pending' else 'checkout_abandoned' end,
case when l.event_status in ('failed','declined') then 'Recuperar pagamento e oferecer alternativa de pagamento.' when l.event_status in ('pending','waiting') then 'Acompanhar pendência e conduzir o cliente à conclusão.' else 'Retomar a jornada e devolver o cliente ao checkout.' end,
case when coalesce(array_length(l.candidate_ids,1),0) = 1 then l.candidate_ids[1] else null end,
case
  when l.transaction_id is null then 'unlinked'
  when coalesce(array_length(l.candidate_ids,1),0) = 0 then 'unlinked'
  when array_length(l.candidate_ids,1) = 1 then 'resolved'
  else 'ambiguous'
end
from linked l where l.processed_at is null order by l.priority desc,l.received_at desc;
$function$;

revoke all on function public.crm_recovery_opportunities(integer) from public;
revoke all on function public.crm_recovery_opportunities(integer) from anon;
grant execute on function public.crm_recovery_opportunities(integer) to authenticated;
