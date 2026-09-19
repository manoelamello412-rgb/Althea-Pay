alter table public.crm_ai_actions
  add column if not exists actor_id uuid null references auth.users(id) on delete set null;

create index if not exists crm_ai_actions_org_conversation_created_idx
  on public.crm_ai_actions(organization_id,conversation_id,created_at desc);

create index if not exists crm_ai_actions_actor_idx
  on public.crm_ai_actions(actor_id)
  where actor_id is not null;

alter table public.crm_ai_actions
  drop constraint if exists crm_ai_actions_status_check;

alter table public.crm_ai_actions
  add constraint crm_ai_actions_status_check
  check (status = any(array[
    'suggested'::text,
    'accepted'::text,
    'dismissed'::text,
    'executing'::text,
    'executed'::text,
    'failed'::text
  ]));

create or replace function public.crm_ai_actions_list(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  v jsonb;
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,false);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',a.id,
      'conversation_id',a.conversation_id,
      'action_type',a.action_type,
      'score',a.score,
      'rationale',a.rationale,
      'status',a.status,
      'payload',a.payload,
      'created_at',a.created_at,
      'executed_at',a.executed_at,
      'actor_id',a.actor_id,
      'execution_id',a.execution_id,
      'execution_message_id',a.execution_message_id
    )
    order by a.created_at desc
  ),'[]'::jsonb)
  into v
  from public.crm_ai_actions a
  where a.organization_id=v_org
    and a.conversation_id=p_conversation_id
    and a.created_at>=v_start;

  return v;
end;
$function$;

revoke all on function public.crm_ai_actions_list(uuid) from public, anon;
grant execute on function public.crm_ai_actions_list(uuid) to authenticated;

create or replace function public.crm_ai_action_create(
  p_conversation_id uuid,
  p_action_type text,
  p_score numeric,
  p_rationale text,
  p_status text default 'suggested',
  p_idempotency_key text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  v_actor uuid:=auth.uid();
  v_existing public.crm_ai_actions%rowtype;
  v_row public.crm_ai_actions%rowtype;
  v_idem text:=nullif(trim(p_idempotency_key),'');
  v_type text:=trim(coalesce(p_action_type,''));
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,true);

  if v_type not in (
    'payment_follow_up',
    'sales_follow_up',
    'recovery_follow_up',
    'qualification',
    'upsell_or_post_sale'
  ) then
    raise exception 'ACTION_NOT_REGISTERED' using errcode='22023';
  end if;

  if p_status not in ('suggested','accepted','dismissed') then
    raise exception 'INVALID_ACTION_STATUS' using errcode='22023';
  end if;

  if coalesce(p_score,0)<0 or coalesce(p_score,0)>100 then
    raise exception 'INVALID_ACTION_SCORE' using errcode='22023';
  end if;

  if v_idem is not null then
    select *
      into v_existing
    from public.crm_ai_actions
    where user_id=v_owner
      and idempotency_key=v_idem
    limit 1;

    if found then
      if v_existing.organization_id<>v_org
         or v_existing.conversation_id is distinct from p_conversation_id then
        raise exception 'IDEMPOTENCY_SCOPE_MISMATCH' using errcode='23505';
      end if;

      return jsonb_build_object(
        'action',to_jsonb(v_existing),
        'replayed',true
      );
    end if;
  end if;

  insert into public.crm_ai_actions(
    user_id,organization_id,actor_id,conversation_id,action_type,score,
    rationale,status,idempotency_key,payload
  )
  values(
    v_owner,v_org,v_actor,p_conversation_id,v_type,coalesce(p_score,0),
    coalesce(p_rationale,''),p_status,v_idem,
    coalesce(p_payload,'{}'::jsonb)
      ||jsonb_build_object('actor_id',v_actor,'organization_id',v_org)
  )
  returning * into v_row;

  return jsonb_build_object(
    'action',to_jsonb(v_row),
    'replayed',false
  );
exception
  when unique_violation then
    if v_idem is not null then
      select *
        into v_existing
      from public.crm_ai_actions
      where user_id=v_owner
        and idempotency_key=v_idem
      limit 1;

      if found
         and v_existing.organization_id=v_org
         and v_existing.conversation_id is not distinct from p_conversation_id then
        return jsonb_build_object(
          'action',to_jsonb(v_existing),
          'replayed',true
        );
      end if;
    end if;
    raise;
end;
$function$;

revoke all on function public.crm_ai_action_create(uuid,text,numeric,text,text,text,jsonb)
  from public, anon;
grant execute on function public.crm_ai_action_create(uuid,text,numeric,text,text,text,jsonb)
  to authenticated;

create or replace function public.crm_ai_action_get(p_action_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid:=auth.uid();
  v_org uuid;
  v_row public.crm_ai_actions%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  v_org:=private.current_organization_id();

  if v_org is null
     or not private.has_org_capability(v_org,'can_view_chats')
     or not private.has_org_capability(v_org,'can_view_values')
     or not private.has_org_capability(v_org,'can_view_customers')
     or not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'AI_ACTION_ACCESS_DENIED' using errcode='42501';
  end if;

  select *
    into v_row
  from public.crm_ai_actions
  where id=p_action_id
    and organization_id=v_org
  limit 1;

  if not found then
    raise exception 'AI_ACTION_NOT_FOUND' using errcode='P0002';
  end if;

  perform 1
  from private.crm_access_context(v_row.conversation_id,true,true,true);

  return jsonb_build_object(
    'id',v_row.id,
    'organization_id',v_row.organization_id,
    'conversation_id',v_row.conversation_id,
    'action_type',v_row.action_type,
    'payload',v_row.payload,
    'status',v_row.status,
    'actor_id',v_row.actor_id,
    'owner_user_id',v_row.user_id
  );
end;
$function$;

revoke all on function public.crm_ai_action_get(uuid) from public, anon;
grant execute on function public.crm_ai_action_get(uuid) to authenticated;

create or replace function public.crm_claim_ai_action(p_action_id uuid)
returns public.crm_ai_actions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid:=private.current_organization_id();
  v public.crm_ai_actions%rowtype;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'REPLY_ACCESS_DENIED' using errcode='42501';
  end if;

  update public.crm_ai_actions
     set status='executing'
   where id=p_action_id
     and organization_id=v_org
     and status='accepted'
  returning * into v;

  if v.id is null then
    raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  perform 1
  from private.crm_access_context(v.conversation_id,true,true,true);

  return v;
end;
$function$;

revoke all on function public.crm_claim_ai_action(uuid) from public, anon;
grant execute on function public.crm_claim_ai_action(uuid) to authenticated;

create or replace function public.crm_execute_ai_action(p_action_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid:=auth.uid();
  v_org uuid:=private.current_organization_id();
  v_owner uuid;
  v_start timestamptz;
  a public.crm_ai_actions%rowtype;
  m public.crm_messages%rowtype;
  body text:=btrim(coalesce(p_body,''));
  v_execution_id uuid;
  v_executing_at timestamptz;
  v_tool_key text;
begin
  if v_actor is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if not private.has_org_capability(v_org,'can_reply_chats')
     or not private.has_org_capability(v_org,'can_view_values')
     or not private.has_org_capability(v_org,'can_view_customers') then
    raise exception 'AI_ACTION_ACCESS_DENIED' using errcode='42501';
  end if;

  if body='' then
    raise exception 'MESSAGE_EMPTY' using errcode='22023';
  end if;
  if length(body)>10000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode='22001';
  end if;

  select *
    into a
  from public.crm_ai_actions
  where id=p_action_id
    and organization_id=v_org
    and status='accepted'
  for update;

  if not found then
    raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  select owner_user_id,history_start
    into v_owner,v_start
  from private.crm_access_context(a.conversation_id,true,true,true);

  if a.user_id<>v_owner then
    raise exception 'AI_ACTION_OWNER_MISMATCH' using errcode='42501';
  end if;

  if a.action_type not in (
    'payment_follow_up',
    'sales_follow_up',
    'recovery_follow_up',
    'qualification',
    'upsell_or_post_sale'
  ) then
    raise exception 'ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  v_tool_key:=a.action_type;
  v_executing_at:=now();
  v_execution_id:=coalesce(a.execution_id,gen_random_uuid());

  update public.crm_ai_actions
     set execution_id=v_execution_id,
         executing_at=v_executing_at,
         execution_message_id=null,
         actor_id=v_actor,
         execution_provenance=jsonb_build_object(
           'tool',jsonb_build_object(
             'key',v_tool_key,
             'executor','crm_execute_ai_action',
             'authorization','organization_operator',
             'confirmation','human_approval',
             'risk','operational',
             'tenant_scope','organization_id'
           ),
           'authorization',jsonb_build_object(
             'authenticated',true,
             'organization_id',v_org,
             'actor_id',v_actor,
             'operation_owner_user_id',v_owner,
             'can_reply_chats',true,
             'can_view_values',true,
             'can_view_customers',true
           ),
           'input',jsonb_build_object(
             'source','crm_ai_actions.payload.ai_draft',
             'sha256',encode(extensions.digest(body,'sha256'),'hex'),
             'length',length(body),
             'secret_free',true
           ),
           'validation',jsonb_build_object(
             'input_non_empty',true,
             'input_length_valid',true,
             'action_type_registered',true
           ),
           'execution',jsonb_build_object(
             'status','executing',
             'execution_id',v_execution_id,
             'started_at',v_executing_at
           )
         ),
         status='executing'
   where id=a.id
     and organization_id=v_org
     and status='accepted';

  if not found then
    raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(a.conversation_id::text,0));

  select *
    into m
  from public.crm_messages
  where organization_id=v_org
    and user_id=v_owner
    and client_message_id=('ai:'||a.id)
  limit 1;

  if not found then
    select *
      into m
    from public.crm_operator_send_message(a.conversation_id,body,'ai:'||a.id);
  end if;

  update public.crm_ai_actions
     set status='executed',
         executed_at=now(),
         execution_message_id=m.id,
         actor_id=v_actor,
         execution_provenance=execution_provenance || jsonb_build_object(
           'output',jsonb_build_object(
             'message_id',m.id,
             'message_persisted',m.id is not null
           ),
           'validation',jsonb_build_object(
             'input_non_empty',true,
             'input_length_valid',true,
             'action_type_registered',true,
             'authorization_valid',true,
             'result_valid',m.id is not null
           ),
           'execution',jsonb_build_object(
             'status','executed',
             'execution_id',v_execution_id,
             'started_at',v_executing_at,
             'completed_at',now()
           )
         )
   where id=a.id
     and organization_id=v_org
     and status='executing';

  return jsonb_build_object(
    'ok',true,
    'action_id',a.id,
    'execution_id',v_execution_id,
    'status','executed',
    'executed_at',now(),
    'message',
      (to_jsonb(m)-'metadata')
      ||jsonb_build_object('metadata',private.redact_crm_metadata(m.metadata,true,true))
  );
exception
  when others then
    if a.id is not null then
      update public.crm_ai_actions
         set status='accepted'
       where id=a.id
         and organization_id=v_org
         and status='executing';
    end if;
    raise;
end;
$function$;

revoke all on function public.crm_execute_ai_action(uuid,text) from public, anon;
grant execute on function public.crm_execute_ai_action(uuid,text) to authenticated;
