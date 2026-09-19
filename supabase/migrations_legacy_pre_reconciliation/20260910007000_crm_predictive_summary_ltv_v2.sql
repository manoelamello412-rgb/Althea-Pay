create or replace function public.crm_predictive_evaluation_summary(p_model_version text default null) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_user uuid:=auth.uid(); v_total bigint; v_evaluated bigint; v_pending bigint; v_conv_mae numeric; v_rec_mae numeric; v_ltv_mae numeric; v_conv_brier numeric; v_rec_brier numeric;
begin
 if v_user is null then raise exception 'UNAUTHORIZED'; end if;
 select count(*) into v_total from public.crm_predictive_evaluations where user_id=v_user and (p_model_version is null or model_version=p_model_version);
 select count(*) into v_evaluated from public.crm_predictive_evaluations where user_id=v_user and (p_model_version is null or model_version=p_model_version) and evaluated_at is not null;
 v_pending:=v_total-v_evaluated;
 select avg(abs(predicted_conversion-actual_conversion::int)) into v_conv_mae from public.crm_predictive_evaluations where user_id=v_user and actual_conversion is not null and (p_model_version is null or model_version=p_model_version);
 select avg(abs(predicted_recovery-actual_recovery::int)) into v_rec_mae from public.crm_predictive_evaluations where user_id=v_user and actual_recovery is not null and (p_model_version is null or model_version=p_model_version);
 select avg(abs(predicted_ltv-actual_ltv)) into v_ltv_mae from public.crm_predictive_evaluations where user_id=v_user and actual_ltv is not null and (p_model_version is null or model_version=p_model_version);
 select avg(power(predicted_conversion-actual_conversion::int,2)) into v_conv_brier from public.crm_predictive_evaluations where user_id=v_user and actual_conversion is not null and (p_model_version is null or model_version=p_model_version);
 select avg(power(predicted_recovery-actual_recovery::int,2)) into v_rec_brier from public.crm_predictive_evaluations where user_id=v_user and actual_recovery is not null and (p_model_version is null or model_version=p_model_version);
 return jsonb_build_object('model_version',p_model_version,'total',v_total,'evaluated',v_evaluated,'pending',v_pending,'evaluation_coverage',case when v_total=0 then 0 else v_evaluated::numeric/v_total end,'conversion_mae',v_conv_mae,'recovery_mae',v_rec_mae,'ltv_mae',v_ltv_mae,'conversion_brier',v_conv_brier,'recovery_brier',v_rec_brier,'status',case when v_evaluated=0 then 'awaiting_real_outcomes' else 'evaluated' end);
end $$;
revoke all on function public.crm_predictive_evaluation_summary(text) from public,anon;
grant execute on function public.crm_predictive_evaluation_summary(text) to authenticated;