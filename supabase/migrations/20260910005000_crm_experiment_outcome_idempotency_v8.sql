with ranked as (select id,row_number() over(partition by experiment_id,subject_key,outcome order by occurred_at,id) rn from public.crm_experiment_outcomes)
delete from public.crm_experiment_outcomes o using ranked r where o.id=r.id and r.rn>1;
create unique index if not exists crm_exp_outcome_subject_once_uidx on public.crm_experiment_outcomes(experiment_id,subject_key,outcome);