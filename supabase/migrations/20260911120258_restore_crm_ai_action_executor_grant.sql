revoke all on function public.crm_execute_ai_action(uuid,text) from public, anon;
grant execute on function public.crm_execute_ai_action(uuid,text) to authenticated;
