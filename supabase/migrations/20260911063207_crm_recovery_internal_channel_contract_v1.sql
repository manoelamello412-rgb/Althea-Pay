-- CRM recovery messages must use the canonical internal channel.
-- The crm_messages.channel CHECK does not allow the legacy 'system' value.
DO $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='crm_recovery_execute'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid';

  if v_def is null then
    raise exception 'crm_recovery_execute_not_found';
  end if;

  if position('''system'',case when v_name' in v_def) = 0 then
    raise exception 'crm_recovery_execute_contract_not_found';
  end if;

  v_def := replace(v_def, '''system'',case when v_name', '''internal'',case when v_name');
  execute v_def;
end $$;
