create or replace function public.crm_capture_predictive_outcomes(p_model_version text default 'deterministic_behavioral_v1')
returns integer language plpgsql security definer set search_path=public as $$
declare n integer:=0;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 with candidates as (
   select e.id,e.conversation_id,e.predicted_conversion_probability,e.predicted_recovery_probability
   from public.crm_predictive_evaluations e
   where e.model_version=p_model_version and e.actual_conversion is null
 ), outcomes as (
   select c.id,
     exists(select 1 from public.sales s join public.crm_conversations cv on cv.id=c.conversation_id where cv.id=c.conversation_id and s.user_id=cv.user_id and (lower(s.email)=lower(cv.buyer_email) or s.transaction_id=cv.transaction_id) and coalesce(s.status,'') in ('paid','approved','completed','success')) as converted,
     exists(select 1 from public.crm_recovery_opportunities r where r.conversation_id=c.conversation_id and lower(coalesce(r.status,'')) in ('recovered','converted','paid','success')) as recovered
   from candidates c
 )
 update public.crm_predictive_evaluations e set actual_conversion=o.converted,actual_recovery=o.recovered,evaluated_at=now() from outcomes o where e.id=o.id and (o.converted or o.recovered); get diagnostics n=row_count; return n;
end; $$;
revoke all on function public.crm_capture_predictive_outcomes(text) from public,anon,authenticated;
grant execute on function public.crm_capture_predictive_outcomes(text) to service_role;
