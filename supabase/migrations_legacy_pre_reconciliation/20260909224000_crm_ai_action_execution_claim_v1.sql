create or replace function public.crm_claim_ai_action(p_action_id uuid)
returns public.crm_ai_actions
language plpgsql
security invoker
set search_path=public
as $$
declare v public.crm_ai_actions%rowtype;
begin
 update public.crm_ai_actions set status='executing' where id=p_action_id and user_id=auth.uid() and status='accepted' returning * into v;
 if v.id is null then raise exception 'AI_ACTION_NOT_EXECUTABLE'; end if;
 return v;
end;
$$;
revoke all on function public.crm_claim_ai_action(uuid) from public,anon;
grant execute on function public.crm_claim_ai_action(uuid) to authenticated;
