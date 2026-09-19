create or replace function public.crm_experiment_report(p_experiment_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
with e as (select id from public.crm_experiments where id=p_experiment_id and user_id=auth.uid()),
variants as (
 select v.id,v.name,v.weight,count(distinct x.subject_key)::int exposures,
 count(distinct case when o.outcome='converted' then o.subject_key end)::int conversions,
 coalesce(sum(case when o.outcome='revenue' then o.value else 0 end),0) revenue
 from public.crm_experiment_variants v join e on e.id=v.experiment_id
 left join public.crm_experiment_exposures x on x.variant_id=v.id
 left join public.crm_experiment_outcomes o on o.variant_id=v.id and o.subject_key=x.subject_key
 group by v.id,v.name,v.weight
), scored as (
 select *,case when exposures>0 then conversions::numeric/exposures else 0 end conversion_rate from variants
), best as (
 select s.* from scored s order by s.conversion_rate desc,s.revenue desc,s.id limit 1
), totals as (
 select coalesce(sum(exposures),0)::int exposures,coalesce(sum(conversions),0)::int conversions,coalesce(sum(revenue),0) revenue from scored
), learning as (
 select coalesce(jsonb_agg(jsonb_build_object('variant_id',s.id,'name',s.name,'conversion_rate',round(s.conversion_rate,6),'lift_vs_best',case when b.conversion_rate>0 then round((s.conversion_rate-b.conversion_rate)/b.conversion_rate,6) else 0 end,'sample_size',s.exposures,'confidence_level','descriptive_only') order by s.conversion_rate desc),'[]'::jsonb) report from scored s cross join best b
)
select jsonb_build_object('experiment_id',p_experiment_id,'variants',coalesce((select jsonb_agg(jsonb_build_object('variant_id',id,'name',name,'weight',weight,'exposures',exposures,'conversions',conversions,'conversion_rate',round(conversion_rate,6),'revenue',revenue) order by name) from scored),'[]'::jsonb),'totals',(select to_jsonb(totals) from totals),'learning',(select report from learning),'recommended_variant',(select jsonb_build_object('variant_id',id,'name',name,'conversion_rate',round(conversion_rate,6),'reason','Maior taxa de conversão observada; recomendação descritiva, sem significância estatística inferida.') from best),'generated_at',now());
$$;
revoke all on function public.crm_experiment_report(uuid) from public,anon;
grant execute on function public.crm_experiment_report(uuid) to authenticated;
