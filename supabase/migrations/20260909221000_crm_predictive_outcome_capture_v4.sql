create or replace function public.crm_predictive_capture_outcomes(p_limit integer default 500) returns integer language plpgsql security definer set search_path=public as $$
declare r record; n int:=0; conv boolean; rec boolean; ltv numeric;
begin
 if current_setting('request.jwt.claim.role',true) <> 'service_role' then raise exception 'service_role_required'; end if;
 for r in select e.id,e.user_id,e.conversation_id from public.crm_predictive_evaluations e where e.actual_conversion is null or e.actual_recovery is null or e.actual_ltv is null order by e.created_at asc limit greatest(1,least(p_limit,5000)) loop
  select exists(select 1 from public.sales s join public.crm_conversations c on c.id=r.conversation_id and c.user_id=r.user_id where s.user_id=r.user_id and lower(coalesce(s.status,'')) in ('paid','approved','completed','succeeded') and ((c.transaction_id is not null and c.transaction_id~*'^[0-9a-f-]{36}$' and s.transaction_id=c.transaction_id::uuid) or (c.buyer_email is not null and lower(coalesce(s.data->>'email',''))=lower(c.buyer_email)) or (c.customer_id is not null and s.data->>'customer_id'=c.customer_id))) into conv;
  select exists(select 1 from public.checkout_sessions cs join public.crm_conversations c on c.user_id=r.user_id and c.id=r.conversation_id where cs.user_id=r.user_id and coalesce(cs.recovery_count,0)>0 and cs.completed_at is not null and ((c.buyer_email is not null and lower(coalesce(cs.customer->>'email',''))=lower(c.buyer_email)) or (c.funnel_id is not null and cs.funnel_id=c.funnel_id and c.product_id is not null and cs.product_id=c.product_id))) into rec;
  select coalesce(sum(s.amount),0) into ltv from public.sales s join public.crm_conversations c on c.id=r.conversation_id and c.user_id=r.user_id where s.user_id=r.user_id and lower(coalesce(s.status,'')) in ('paid','approved','completed','succeeded') and ((c.transaction_id is not null and c.transaction_id~*'^[0-9a-f-]{36}$' and s.transaction_id=c.transaction_id::uuid) or (c.buyer_email is not null and lower(coalesce(s.data->>'email',''))=lower(c.buyer_email)) or (c.customer_id is not null and s.data->>'customer_id'=c.customer_id));
  update public.crm_predictive_evaluations set actual_conversion=coalesce(actual_conversion,conv),actual_recovery=coalesce(actual_recovery,rec),actual_ltv=coalesce(actual_ltv,ltv),evaluated_at=now() where id=r.id;
  n:=n+1;
 end loop; return n;
end; $$;
revoke all on function public.crm_predictive_capture_outcomes(integer) from public,anon,authenticated;
grant execute on function public.crm_predictive_capture_outcomes(integer) to service_role;
