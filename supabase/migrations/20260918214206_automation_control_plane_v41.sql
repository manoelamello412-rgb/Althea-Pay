create or replace function public.crm_check_automation_rate_limit_org(
  p_organization_id uuid,p_rule_id uuid,p_limit integer default 60,p_window_seconds integer default 60
) returns boolean language plpgsql security definer set search_path='public','pg_catalog'
as $function$
declare v_count integer;
begin
  if p_organization_id is null or p_rule_id is null then return false; end if;
  if p_limit<1 or p_window_seconds<1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('automation-rate-org:'||p_organization_id::text||':'||p_rule_id::text));
  select count(*) into v_count
  from public.automation_execution_attempts a
  join public.automation_executions e on e.id=a.execution_id
  where e.organization_id=p_organization_id and e.rule_id=p_rule_id
    and a.started_at>=now()-make_interval(secs=>least(p_window_seconds,86400));
  return v_count<least(p_limit,10000);
end;
$function$;
revoke all on function public.crm_check_automation_rate_limit_org(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.crm_check_automation_rate_limit_org(uuid,uuid,integer,integer) to service_role;

create or replace function public.crm_check_automation_rate_limit(
  p_user_id uuid,p_rule_id uuid,p_limit integer default 60,p_window_seconds integer default 60
) returns boolean language plpgsql security definer set search_path='public','pg_catalog'
as $function$
declare v_org uuid;
begin
  select organization_id into v_org from public.automation_rules where id=p_rule_id;
  if v_org is null then return false; end if;
  return public.crm_check_automation_rate_limit_org(v_org,p_rule_id,p_limit,p_window_seconds);
end;
$function$;
revoke all on function public.crm_check_automation_rate_limit(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.crm_check_automation_rate_limit(uuid,uuid,integer,integer) to service_role;

create or replace function public.crm_cancel_automation_execution(p_execution_id uuid,p_reason text default null)
returns public.automation_executions language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare r public.automation_executions; v_org uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select organization_id into v_org from public.automation_executions where id=p_execution_id;
  if v_org is null then return null; end if;
  if not private.has_org_role(v_org,array['owner','admin','manager']) then raise exception using errcode='42501',message='forbidden'; end if;
  update public.automation_executions
  set status='cancelled',cancelled_at=now(),cancellation_reason=left(coalesce(p_reason,'manual cancellation'),1000),
      next_retry_at=null,scheduled_at=null
  where id=p_execution_id and organization_id=v_org and status in ('pending','scheduled','failed') and dead_lettered_at is null
  returning * into r;
  return r;
end;
$function$;
revoke all on function public.crm_cancel_automation_execution(uuid,text) from public,anon;
grant execute on function public.crm_cancel_automation_execution(uuid,text) to authenticated;

create or replace function public.crm_replay_automation_execution(p_execution_id uuid,p_reason text default null)
returns public.automation_executions language plpgsql security definer
set search_path='public','private','extensions','pg_catalog'
as $function$
declare r public.automation_executions; v_key text; v_existing public.idempotency_keys; v_idem_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select * into r from public.automation_executions where id=p_execution_id for update;
  if not found then raise exception 'automation_execution_not_found'; end if;
  if not private.has_org_role(r.organization_id,array['owner','admin','manager']) then raise exception using errcode='42501',message='forbidden'; end if;
  v_key:='automation-replay:'||r.id::text||':'||extract(epoch from coalesce(r.dead_lettered_at,r.created_at))::text;
  select * into v_existing from public.idempotency_keys
  where user_id=auth.uid() and scope='automation_replay' and idempotency_key=v_key for update;
  if found then return r; end if;
  if r.status<>'dead_letter' then raise exception 'automation_execution_not_dead_letter'; end if;
  insert into public.idempotency_keys(user_id,scope,idempotency_key,status,resource_type,resource_id,response_payload,request_digest)
  values(auth.uid(),'automation_replay',v_key,'processing','automation_execution',r.id::text,
         jsonb_build_object('execution_id',r.id,'reason',p_reason),encode(extensions.digest(v_key,'sha256'),'hex'))
  returning id into v_idem_id;
  update public.automation_executions
  set status='scheduled',dead_lettered_at=null,error_message=null,next_retry_at=null,scheduled_at=now(),
      replayed_at=now(),replay_count=coalesce(replay_count,0)+1,cancellation_reason=left(coalesce(p_reason,'manual replay'),1000)
  where id=r.id returning * into r;
  insert into public.audit_logs(user_id,actor_id,action,resource_type,resource_id,metadata)
  values(auth.uid(),auth.uid(),'automation.replay','automation_execution',r.id::text,
         jsonb_build_object('organization_id',r.organization_id,'replay_idempotency_id',v_idem_id,'replay_key',v_key,'reason',p_reason,'replay_count',r.replay_count));
  update public.idempotency_keys
  set status='completed',response_code=200,response_payload=jsonb_build_object('execution_id',r.id,'status',r.status,'replay_count',r.replay_count),resource_id=r.id::text
  where id=v_idem_id;
  return r;
end;
$function$;
revoke all on function public.crm_replay_automation_execution(uuid,text) from public,anon;
grant execute on function public.crm_replay_automation_execution(uuid,text) to authenticated;

create or replace function public.automation_rule_upsert_v1(
  p_rule_id uuid default null,p_name text default null,p_status text default 'draft',
  p_trigger_config jsonb default '{}'::jsonb,p_action_config jsonb default '{}'::jsonb
) returns public.automation_rules language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_uid uuid:=auth.uid(); v_org uuid; v_rule public.automation_rules; v_event_type text; v_funnel_id text;
  v_actions jsonb; v_action jsonb; v_action_type text; v_channel text; v_body text;
  v_status text:=lower(coalesce(nullif(btrim(p_status),''),'draft'));
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.has_org_role(v_org,array['owner','admin','manager']) then raise exception using errcode='42501',message='forbidden'; end if;
  if p_name is null or btrim(p_name)='' then raise exception using errcode='22023',message='automation_name_required'; end if;
  if length(btrim(p_name))>120 then raise exception using errcode='22023',message='automation_name_too_long'; end if;
  if v_status not in ('draft','active','paused') then raise exception using errcode='22023',message='invalid_automation_status'; end if;
  if jsonb_typeof(p_trigger_config)<>'object' then raise exception using errcode='22023',message='invalid_trigger_config'; end if;
  if jsonb_typeof(p_action_config)<>'object' then raise exception using errcode='22023',message='invalid_action_config'; end if;
  if pg_column_size(p_trigger_config)>20000 or pg_column_size(p_action_config)>30000 then raise exception using errcode='22023',message='automation_config_too_large'; end if;

  v_event_type:=coalesce(nullif(btrim(p_trigger_config->>'event_type'),''),'*');
  if v_event_type<>'*' and not exists(select 1 from public.funnel_event_types where enabled=true and canonical_event_type=v_event_type)
    then raise exception using errcode='22023',message='invalid_automation_event_type'; end if;

  v_funnel_id:=nullif(btrim(p_trigger_config->>'funnel_id'),'');
  if v_funnel_id is not null and v_funnel_id<>'*'
     and not exists(select 1 from public.funnels where id=v_funnel_id and organization_id=v_org and deleted_at is null)
    then raise exception using errcode='22023',message='automation_funnel_not_found'; end if;

  if p_trigger_config ? 'conditions' then
    if jsonb_typeof(p_trigger_config->'conditions')<>'array' or jsonb_array_length(p_trigger_config->'conditions')>20
      then raise exception using errcode='22023',message='invalid_automation_conditions'; end if;
  end if;

  v_actions:=case when jsonb_typeof(p_action_config->'actions')='array' then p_action_config->'actions' else jsonb_build_array(p_action_config) end;
  if jsonb_array_length(v_actions)<1 or jsonb_array_length(v_actions)>5 then raise exception using errcode='22023',message='invalid_automation_actions'; end if;

  for v_action in select value from jsonb_array_elements(v_actions)
  loop
    if jsonb_typeof(v_action)<>'object' then raise exception using errcode='22023',message='invalid_automation_action'; end if;
    v_action_type:=lower(coalesce(nullif(btrim(v_action->>'type'),''),nullif(btrim(v_action->>'action'),'')));
    if v_action_type not in ('log','alert','send_crm_message','set_conversation_status')
      then raise exception using errcode='22023',message='unsupported_automation_action'; end if;
    if v_action_type='send_crm_message' then
      v_channel:=lower(coalesce(nullif(btrim(v_action->>'channel'),''),'funnel_chat'));
      if v_channel<>'funnel_chat' then raise exception using errcode='22023',message='automation_channel_not_enabled'; end if;
      v_body:=coalesce(v_action->>'body',v_action->>'message','');
      if btrim(v_body)='' then raise exception using errcode='22023',message='automation_message_required'; end if;
      if length(v_body)>4000 then raise exception using errcode='22023',message='automation_message_too_long'; end if;
    elsif v_action_type='set_conversation_status' then
      if lower(coalesce(v_action->>'status','')) not in ('open','pending','closed')
        then raise exception using errcode='22023',message='invalid_conversation_status'; end if;
    end if;
  end loop;

  if p_rule_id is null then
    insert into public.automation_rules(user_id,organization_id,name,status,trigger_config,action_config)
    values(v_uid,v_org,btrim(p_name),v_status,p_trigger_config,p_action_config) returning * into v_rule;
  else
    update public.automation_rules
    set name=btrim(p_name),status=v_status,trigger_config=p_trigger_config,action_config=p_action_config,updated_at=now()
    where id=p_rule_id and organization_id=v_org returning * into v_rule;
    if v_rule.id is null then raise exception using errcode='P0002',message='automation_rule_not_found'; end if;
  end if;
  return v_rule;
end;
$function$;
revoke all on function public.automation_rule_upsert_v1(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.automation_rule_upsert_v1(uuid,text,text,jsonb,jsonb) to authenticated;

create or replace function public.automation_rule_delete_v1(p_rule_id uuid)
returns boolean language plpgsql security definer set search_path='public','private','pg_catalog'
as $function$
declare v_uid uuid:=auth.uid(); v_org uuid;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.has_org_role(v_org,array['owner','admin']) then raise exception using errcode='42501',message='forbidden'; end if;
  if exists(select 1 from public.automation_executions where rule_id=p_rule_id and organization_id=v_org) then
    update public.automation_rules set status='paused',updated_at=now() where id=p_rule_id and organization_id=v_org;
    return false;
  end if;
  delete from public.automation_rules where id=p_rule_id and organization_id=v_org;
  return found;
end;
$function$;
revoke all on function public.automation_rule_delete_v1(uuid) from public,anon;
grant execute on function public.automation_rule_delete_v1(uuid) to authenticated;

create or replace function public.automation_operations_v1(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='public','private','pg_catalog'
as $function$
declare v_uid uuid:=auth.uid(); v_org uuid; v_limit integer:=greatest(1,least(coalesce(p_limit,100),200));
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then raise exception using errcode='42501',message='organization_required'; end if;

  return (
    with rule_rows as (
      select r.id,r.name,r.status,r.trigger_config,r.action_config,r.created_at,r.updated_at,
        coalesce(stats.executions_24h,0)::bigint as executions_24h,
        coalesce(stats.completed_24h,0)::bigint as completed_24h,
        coalesce(stats.failed_24h,0)::bigint as failed_24h,
        stats.last_status,stats.last_execution_at
      from public.automation_rules r
      left join lateral (
        select count(*) filter(where e.created_at>=now()-interval '24 hours') as executions_24h,
          count(*) filter(where e.created_at>=now()-interval '24 hours' and e.status='completed') as completed_24h,
          count(*) filter(where e.created_at>=now()-interval '24 hours' and e.status in ('failed','dead_letter')) as failed_24h,
          (array_agg(e.status order by e.created_at desc))[1] as last_status,
          max(e.created_at) as last_execution_at
        from public.automation_executions e
        where e.organization_id=v_org and e.rule_id=r.id
      ) stats on true
      where r.organization_id=v_org order by r.updated_at desc limit v_limit
    ),
    execution_rows as (
      select e.id,e.rule_id,r.name as rule_name,e.status,e.action_type,e.event_id,e.execution_key,
        e.error_message,e.attempt_count,e.max_attempts,e.next_retry_at,e.scheduled_at,e.dead_lettered_at,
        e.cancelled_at,e.replay_count,e.created_at,e.started_at,e.completed_at,
        coalesce(a.attempts,0)::bigint as attempts,i.event_type,i.funnel_id
      from public.automation_executions e
      join public.automation_rules r on r.id=e.rule_id and r.organization_id=e.organization_id
      left join public.integration_events i on i.id=e.event_id and i.organization_id=e.organization_id
      left join lateral (
        select count(*)::bigint as attempts from public.automation_execution_attempts aa
        where aa.execution_id=e.id and aa.organization_id=e.organization_id
      ) a on true
      where e.organization_id=v_org order by e.created_at desc limit v_limit
    ),
    metrics as (
      select
        (select count(*)::bigint from public.automation_rules r where r.organization_id=v_org) as rules,
        (select count(*)::bigint from public.automation_rules r where r.organization_id=v_org and r.status='active') as active_rules,
        (select count(*)::bigint from public.automation_rules r where r.organization_id=v_org and r.status='draft') as draft_rules,
        (select count(*)::bigint from public.automation_rules r where r.organization_id=v_org and r.status='paused') as paused_rules,
        (select count(*)::bigint from public.automation_executions e where e.organization_id=v_org and e.created_at>=now()-interval '24 hours') as executions_24h,
        (select count(*)::bigint from public.automation_executions e where e.organization_id=v_org and e.created_at>=now()-interval '24 hours' and e.status='completed') as completed_24h,
        (select count(*)::bigint from public.automation_executions e where e.organization_id=v_org and e.created_at>=now()-interval '24 hours' and e.status in ('failed','dead_letter')) as failed_24h,
        (select count(*)::bigint from public.automation_executions e where e.organization_id=v_org and e.status='dead_letter') as dead_letter,
        (select count(*)::bigint from public.automation_executions e where e.organization_id=v_org and e.status in ('scheduled','pending')) as scheduled_or_pending
    ),
    event_types as (
      select coalesce(jsonb_agg(jsonb_build_object('event_type',t.canonical_event_type,'protocol_version',t.protocol_version) order by t.canonical_event_type),'[]'::jsonb) value
      from (select distinct canonical_event_type,protocol_version from public.funnel_event_types where enabled=true) t
    ),
    funnels as (
      select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.nome) order by f.nome),'[]'::jsonb) value
      from public.funnels f where f.organization_id=v_org and f.deleted_at is null
    )
    select jsonb_build_object(
      'metrics',(select to_jsonb(m) from metrics m),
      'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc) from rule_rows r),'[]'::jsonb),
      'executions',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from execution_rows e),'[]'::jsonb),
      'event_types',(select value from event_types),
      'funnels',(select value from funnels),
      'capabilities',jsonb_build_object('actions',jsonb_build_array('log','alert','send_crm_message','set_conversation_status'),'max_actions',5,'max_conditions',20,'financial_actions_direct',false)
    )
  );
end;
$function$;
revoke all on function public.automation_operations_v1(integer) from public,anon;
grant execute on function public.automation_operations_v1(integer) to authenticated;
