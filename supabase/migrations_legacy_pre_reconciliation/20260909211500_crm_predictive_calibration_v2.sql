create or replace function public.crm_predictive_evaluation_summary(p_model_version text default 'deterministic_behavioral_v1') returns jsonb language sql stable security invoker set search_path=public as $$
with s as (
 select * from public.crm_predictive_evaluations where user_id=auth.uid() and model_version=p_model_version
), c as (
 select count(*) filter(where actual_conversion is not null) n_conversion,
 count(*) filter(where actual_recovery is not null) n_recovery,
 avg(abs(predicted_conversion-(case when actual_conversion then 1 else 0 end))) filter(where actual_conversion is not null) mae_conversion,
 avg(abs(predicted_recovery-(case when actual_recovery then 1 else 0 end))) filter(where actual_recovery is not null) mae_recovery,
 avg(power(predicted_conversion-(case when actual_conversion then 1 else 0 end),2)) filter(where actual_conversion is not null) brier_conversion,
 avg(power(predicted_recovery-(case when actual_recovery then 1 else 0 end),2)) filter(where actual_recovery is not null) brier_recovery
 from s
), bins as (
 select jsonb_agg(jsonb_build_object('bin',b,'lower',b/10.0,'upper',(b+1)/10.0,'n',n,'predicted_rate',predicted_rate,'actual_rate',actual_rate) order by b) data
 from (
  select width_bucket(predicted_conversion,0,1,10)-1 b,count(*) n,avg(predicted_conversion) predicted_rate,avg((case when actual_conversion then 1.0 else 0.0 end)) actual_rate
  from s where actual_conversion is not null group by 1
 ) q
)
select jsonb_build_object('model_version',p_model_version,'evaluated_examples',greatest(n_conversion,n_recovery),'conversion_mae',mae_conversion,'recovery_mae',mae_recovery,'conversion_brier',brier_conversion,'recovery_brier',brier_recovery,'conversion_calibration_bins',coalesce((select data from bins),'[]'::jsonb),'evaluation_type','post_outcome_calibration','generated_at',now()) from c $$;
revoke all on function public.crm_predictive_evaluation_summary(text) from anon;
grant execute on function public.crm_predictive_evaluation_summary(text) to authenticated;
