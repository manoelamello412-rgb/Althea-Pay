-- Canonical AI execution channel contract.
-- Customer-facing delivery remains delegated to the existing operator mutation.
create or replace function public.crm_ai_execute_action_channel_aware(p_action_id uuid)
returns public.crm_ai_actions
language plpgsql
security definer
set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); a public.crm_ai_actions;
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into a from public.crm_ai_actions where id=p_action_id and user_id=v_user_id for update;
 if not found then raise exception 'AI_ACTION_NOT_FOUND' using errcode='P0002'; end if;
 if a.status <> 'accepted' then raise exception 'AI_ACTION_NOT_ACCEPTED' using errcode='P0001'; end if;
 update public.crm_ai_actions set status='executing',updated_at=now() where id=a.id and user_id=v_user_id and status='accepted' returning * into a;
 if not found then raise exception 'AI_ACTION_CONCURRENCY_CONFLICT' using errcode='40001'; end if;
 return a;
end $$;
revoke all on function public.crm_ai_execute_action_channel_aware(uuid) from public,anon;
grant execute on function public.crm_ai_execute_action_channel_aware(uuid) to authenticated;
