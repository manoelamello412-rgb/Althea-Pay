-- CRM/Multi-CRM performance hardening.
-- Keep owner-scoped and operational lookup paths covered without removing existing indexes.
create index if not exists crm_messages_conversation_created_idx_v2 on public.crm_messages(conversation_id, created_at);
create index if not exists crm_ai_actions_user_conversation_created_idx on public.crm_ai_actions(user_id, conversation_id, created_at desc);
create index if not exists crm_experiment_exposures_user_experiment_subject_idx on public.crm_experiment_exposures(user_id, experiment_id, subject_key);
create index if not exists crm_experiment_outcomes_user_experiment_subject_idx on public.crm_experiment_outcomes(user_id, experiment_id, subject_key);
create index if not exists automation_executions_user_rule_key_idx_v2 on public.automation_executions(user_id, rule_id, execution_key);
