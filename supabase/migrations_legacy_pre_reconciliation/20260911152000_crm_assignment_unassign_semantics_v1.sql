create or replace function public.crm_assign_conversation(
  p_conversation_id uuid,
  p_agent_id uuid default null,
  p_team_id uuid default null,
  p_priority text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_uid uuid:=auth.uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.crm_conversations where id=p_conversation_id and user_id=v_uid) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_agent_id is not null and not exists(select 1 from public.crm_agents where id=p_agent_id and user_id=v_uid) then raise exception 'AGENT_NOT_FOUND'; end if;
  if p_team_id is not null and not exists(select 1 from public.crm_teams where id=p_team_id and user_id=v_uid and active) then raise exception 'TEAM_NOT_FOUND'; end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'INVALID_PRIORITY'; end if;

  update public.crm_conversations
     set assigned_to=p_agent_id,
         priority=coalesce(p_priority,priority),
         updated_at=now(),
         metadata=case
           when p_team_id is null then metadata
           else jsonb_set(coalesce(metadata,'{}'::jsonb),'{team_id}',to_jsonb(p_team_id::text),true)
         end
   where id=p_conversation_id and user_id=v_uid
   returning jsonb_build_object(
     'id',id,
     'assigned_to',assigned_to,
     'priority',priority,
     'team_id',metadata->>'team_id',
     'updated_at',updated_at
   ) into v;

  return v;
end $$;

revoke all on function public.crm_assign_conversation(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.crm_assign_conversation(uuid,uuid,uuid,text) to authenticated;
