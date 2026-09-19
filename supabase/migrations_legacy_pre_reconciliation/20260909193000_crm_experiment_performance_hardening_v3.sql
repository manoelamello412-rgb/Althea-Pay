drop index if exists public.crm_experiment_exposures_subject_uq;

drop index if exists public.crm_ai_actions_conversation_idx;
drop index if exists public.idx_crm_conversations_customer;

drop policy if exists crm_experiments_owner on public.crm_experiments;
create policy crm_experiments_owner on public.crm_experiments for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists crm_exp_variants_owner on public.crm_experiment_variants;
create policy crm_exp_variants_owner on public.crm_experiment_variants for all using(experiment_id in(select id from public.crm_experiments where user_id=(select auth.uid()))) with check(experiment_id in(select id from public.crm_experiments where user_id=(select auth.uid())));
drop policy if exists crm_exp_exposures_owner on public.crm_experiment_exposures;
create policy crm_exp_exposures_owner on public.crm_experiment_exposures for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists crm_exp_outcomes_owner on public.crm_experiment_outcomes;
create policy crm_exp_outcomes_owner on public.crm_experiment_outcomes for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create index if not exists crm_experiment_exposures_variant_idx on public.crm_experiment_exposures(variant_id);
create index if not exists crm_experiment_outcomes_user_idx on public.crm_experiment_outcomes(user_id);
create index if not exists crm_experiment_outcomes_variant_idx on public.crm_experiment_outcomes(variant_id);
