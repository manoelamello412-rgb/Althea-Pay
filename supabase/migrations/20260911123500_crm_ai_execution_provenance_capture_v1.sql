-- Canonical AI execution provenance capture.
-- Reuses crm_ai_actions as the existing action ledger; no parallel evidence table.

alter table public.crm_ai_actions
  add column if not exists executing_at timestamptz,
  add column if not exists execution_message_id uuid,
  add column if not exists execution_provenance jsonb not null default '{}'::jsonb;

alter table public.crm_ai_actions
  drop constraint if exists crm_ai_actions_execution_message_id_fkey;

alter table public.crm_ai_actions
  add constraint crm_ai_actions_execution_message_id_fkey
  foreign key (execution_message_id) references public.crm_messages(id);

create index if not exists crm_ai_actions_execution_message_id_idx
  on public.crm_ai_actions (execution_message_id)
  where execution_message_id is not null;

create or replace function public.crm_execute_ai_action(p_action_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid:=auth.uid();
  a public.crm_ai_actions%rowtype;
  m public.crm_messages%rowtype;
  body text:=btrim(coalesce(p_body,''));
  v_execution_id uuid;
  v_executing_at timestamptz;
  v_tool_key text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if body='' then raise exception 'MESSAGE_EMPTY' using errcode='22023'; end if;
  if length(body)>10000 then raise exception 'MESSAGE_TOO_LONG' using errcode='22001'; end if;

  select * into a
  from public.crm_ai_actions
  where id=p_action_id and user_id=uid and status='accepted'
  for update;

  if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
  if a.action_type not in ('payment_follow_up','sales_follow_up','recovery_follow_up','qualification','upsell_or_post_sale') then
    raise exception 'ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  v_tool_key:=a.action_type;
  v_executing_at:=now();

  if a.execution_id is null then
    v_execution_id:=gen_random_uuid();
    update public.crm_ai_actions
      set execution_id=v_execution_id,
          executing_at=v_executing_at,
          execution_message_id=null,
          execution_provenance=jsonb_build_object(
            'tool',jsonb_build_object(
              'key',v_tool_key,
              'executor','crm_execute_ai_action',
              'authorization','authenticated_owner',
              'confirmation','human_approval',
              'risk','operational',
              'tenant_scope','user_id'
            ),
            'authorization',jsonb_build_object('authenticated',true,'owner_match',true),
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
            'execution',jsonb_build_object('status','executing','execution_id',v_execution_id,'started_at',v_executing_at)
          ),
          status='executing'
      where id=a.id and status='accepted';
    if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
    a.execution_id:=v_execution_id;
  else
    v_execution_id:=a.execution_id;
    update public.crm_ai_actions
      set executing_at=v_executing_at,
          execution_message_id=null,
          execution_provenance=jsonb_build_object(
            'tool',jsonb_build_object(
              'key',v_tool_key,
              'executor','crm_execute_ai_action',
              'authorization','authenticated_owner',
              'confirmation','human_approval',
              'risk','operational',
              'tenant_scope','user_id'
            ),
            'authorization',jsonb_build_object('authenticated',true,'owner_match',true),
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
            'execution',jsonb_build_object('status','executing','execution_id',v_execution_id,'started_at',v_executing_at)
          ),
          status='executing'
      where id=a.id and status='accepted';
    if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(a.conversation_id::text,0));

  if not exists(select 1 from public.crm_conversations where id=a.conversation_id and user_id=uid) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  select * into m
  from public.crm_messages
  where user_id=uid and client_message_id=('ai:'||a.id)
  limit 1;

  if not found then
    select * into m from public.crm_operator_send_message(a.conversation_id,body,'ai:'||a.id);
  end if;

  update public.crm_ai_actions
    set status='executed',
        executed_at=now(),
        execution_message_id=m.id,
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
    where id=a.id and status='executing';

  return jsonb_build_object(
    'ok',true,
    'action_id',a.id,
    'execution_id',v_execution_id,
    'status','executed',
    'executed_at',now(),
    'message',to_jsonb(m)
  );
exception when others then
  update public.crm_ai_actions set status='accepted' where id=a.id and status='executing';
  raise;
end;
$function$;

grant execute on function public.crm_execute_ai_action(uuid,text) to authenticated;
