alter table public.automation_executions
  drop constraint if exists automation_executions_user_id_execution_key_key;

drop index if exists public.automation_executions_key_idx;

create index if not exists automation_executions_user_rule_key_idx
  on public.automation_executions(user_id, rule_id, execution_key);
