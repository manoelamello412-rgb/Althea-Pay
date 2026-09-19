create or replace function public.crm_experiment_report(p_experiment_id uuid)
returns jsonb
language sql stable security invoker
set search_path=public
as $$
with e as (select id from public.crm_experiments where id=p_experiment_id and user_id=auth.uid()),
variants as (
 select v.id,v.name,v.weight,
 count(distinct x.subject_key) exposures,
 count(distinct case when o.outcome='converted' then o.subject_key end) conversions,
 coalesce(sum(case when o.outcome='revenue' then o.value else 0 end),0) revenue
 from public.crm_experiment_variants v join e on e.id=v.experiment_id
 left join public.crm_experiment_exposures x on x.variant_id=v.id
 left join public.crm_experiment_outcomes o on o.variant_id=v.id and o.subject_key=x.subject_key
 group by v.id,v.name,v.weight
),
scored as (select v.*,case when exposures>0 then round(conversions::numeric/exposures,6) else 0 end conversion_rate from variants v),
best as (select * from scored order by conversion_rate desc,revenue desc,name limit 1),
totals as (select coalesce(sum(exposures),0) exposures,coalesce(sum(conversions),0) conversions,coalesce(sum(revenue),0) revenue from scored),
annotated as (
 select s.*,s.id=(select id from best) current_leader,
 case when (select exposures from best)>0 and s.id<>(select id from best) then round((s.conversion_rate-(select conversion_rate from best))*100,2) else 0 end uplift_vs_best_pp
 from scored s)
select jsonb_build_object(
 'experiment_id',p_experiment_id,
 'variants',coalesce((select jsonb_agg(jsonb_build_object('variant_id',id,'name',name,'weight',weight,'exposures',exposures,'conversions',conversions,'conversion_rate',conversion_rate,'revenue',revenue,'current_leader',current_leader,'uplift_vs_best_pp',uplift_vs_best_pp) order by name) from annotated),'[]'::jsonb),
 'totals',(select to_jsonb(totals) from totals),
 'learning',jsonb_build_object('status',case when (select exposures from totals)<30 then 'insufficient_sample' when (select count(*) from scored where exposures>0)<2 then 'insufficient_variants' else 'directional' end,'leader_variant_id',(select id from best),'leader_name',(select name from best),'sample_size',(select exposures from totals),'minimum_sample_size',30,'method','directional_conversion_rate_v1'),
 'generated_at',now());
$$;
revoke all on function public.crm_experiment_report(uuid) from public,anon;
grant execute on function public.crm_experiment_report(uuid) to authenticated;
