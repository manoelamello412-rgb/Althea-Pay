
create or replace function public.crm_operator_workspace_v1(
  p_conversation_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_conversation public.crm_conversations%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;

  select * into v_conversation
  from public.crm_conversations
  where id=p_conversation_id and user_id=v_uid;

  if not found then raise exception using errcode='P0002',message='CONVERSATION_NOT_FOUND'; end if;

  return jsonb_build_object(
    'sla',(
      select to_jsonb(s)
      from public.crm_conversation_sla(p_conversation_id) s
      limit 1
    ),
    'notes',coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from public.crm_conversation_notes n
      where n.user_id=v_uid and n.conversation_id=p_conversation_id
    ),'[]'::jsonb),
    'tags',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.tag asc)
      from public.crm_conversation_tags t
      where t.user_id=v_uid and t.conversation_id=p_conversation_id
    ),'[]'::jsonb),
    'available_tags',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name asc)
      from public.crm_tags t
      where t.user_id=v_uid and t.active=true
    ),'[]'::jsonb),
    'tasks',coalesce((
      select jsonb_agg(to_jsonb(t) order by
        case t.status when 'open' then 0 when 'in_progress' then 1 else 2 end,
        t.due_at asc nulls last,
        t.created_at desc
      )
      from (
        select *
        from public.crm_tasks
        where user_id=v_uid and conversation_id=p_conversation_id
        order by created_at desc
        limit 100
      ) t
    ),'[]'::jsonb),
    'quick_replies',coalesce((
      select jsonb_agg(to_jsonb(q) order by q.title asc)
      from public.crm_quick_replies q
      where q.user_id=v_uid
        and q.active=true
        and (q.channel=v_conversation.primary_channel or q.channel='all')
    ),'[]'::jsonb),
    'identities',coalesce((
      select jsonb_agg(to_jsonb(i) order by i.updated_at desc)
      from public.crm_channel_identities i
      where i.user_id=v_uid
        and (
          i.conversation_id=p_conversation_id
          or (v_conversation.customer_id is not null and i.customer_id=v_conversation.customer_id)
        )
    ),'[]'::jsonb),
    'delivery_events',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',d.id,
          'channel_account_id',d.channel_account_id,
          'external_message_id',d.external_message_id,
          'status',d.status,
          'occurred_at',d.occurred_at,
          'created_at',d.created_at
        )
        order by d.occurred_at desc
      )
      from (
        select *
        from public.crm_channel_delivery_events
        where user_id=v_uid and conversation_id=p_conversation_id
        order by occurred_at desc
        limit 100
      ) d
    ),'[]'::jsonb),
    'outbox',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',o.id,
          'channel',o.channel,
          'external_message_id',o.external_message_id,
          'status',o.status,
          'attempts',o.attempts,
          'max_attempts',o.max_attempts,
          'next_attempt_at',o.next_attempt_at,
          'sent_at',o.sent_at,
          'failed_at',o.failed_at,
          'last_error',o.last_error,
          'created_at',o.created_at,
          'updated_at',o.updated_at
        )
        order by o.created_at desc
      )
      from (
        select *
        from public.crm_channel_message_outbox
        where user_id=v_uid and conversation_id=p_conversation_id
        order by created_at desc
        limit 100
      ) o
    ),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.crm_operator_add_note_v1(
  p_conversation_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_body text:=btrim(coalesce(p_body,''));
  v_note public.crm_conversation_notes%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if v_body='' then raise exception using errcode='22023',message='NOTE_EMPTY'; end if;
  if length(v_body)>10000 then raise exception using errcode='22001',message='NOTE_TOO_LONG'; end if;
  if not exists(select 1 from public.crm_conversations where id=p_conversation_id and user_id=v_uid) then
    raise exception using errcode='P0002',message='CONVERSATION_NOT_FOUND';
  end if;

  insert into public.crm_conversation_notes(user_id,conversation_id,author_id,body)
  values(v_uid,p_conversation_id,v_uid,v_body)
  returning * into v_note;

  return to_jsonb(v_note);
end;
$function$;

create or replace function public.crm_operator_set_tag_v1(
  p_conversation_id uuid,
  p_tag_id uuid,
  p_enabled boolean default true
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_tag public.crm_tags%rowtype;
  v_row public.crm_conversation_tags%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.crm_conversations where id=p_conversation_id and user_id=v_uid) then
    raise exception using errcode='P0002',message='CONVERSATION_NOT_FOUND';
  end if;

  select * into v_tag
  from public.crm_tags
  where id=p_tag_id and user_id=v_uid and active=true;
  if not found then raise exception using errcode='P0002',message='TAG_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text||':'||p_tag_id::text,0));

  if coalesce(p_enabled,true) then
    insert into public.crm_conversation_tags(user_id,conversation_id,tag,tag_id)
    values(v_uid,p_conversation_id,v_tag.name,v_tag.id)
    on conflict(conversation_id,tag) do update
      set tag_id=excluded.tag_id,user_id=excluded.user_id
    returning * into v_row;
    return jsonb_build_object('enabled',true,'tag',to_jsonb(v_row));
  end if;

  delete from public.crm_conversation_tags
  where user_id=v_uid and conversation_id=p_conversation_id
    and (tag_id=p_tag_id or tag=v_tag.name);

  return jsonb_build_object('enabled',false,'tag_id',p_tag_id);
end;
$function$;

create or replace function public.crm_operator_create_task_v1(
  p_conversation_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_title text:=btrim(coalesce(p_title,''));
  v_priority text:=lower(btrim(coalesce(p_priority,'normal')));
  v_assigned_to uuid;
  v_task public.crm_tasks%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if v_title='' then raise exception using errcode='22023',message='TASK_TITLE_REQUIRED'; end if;
  if length(v_title)>200 then raise exception using errcode='22001',message='TASK_TITLE_TOO_LONG'; end if;
  if length(coalesce(p_description,''))>5000 then raise exception using errcode='22001',message='TASK_DESCRIPTION_TOO_LONG'; end if;
  if v_priority not in ('low','normal','high','urgent') then raise exception using errcode='22023',message='INVALID_PRIORITY'; end if;

  select assigned_to into v_assigned_to
  from public.crm_conversations
  where id=p_conversation_id and user_id=v_uid;
  if not found then raise exception using errcode='P0002',message='CONVERSATION_NOT_FOUND'; end if;

  insert into public.crm_tasks(
    user_id,conversation_id,assigned_to,title,description,status,priority,due_at,created_by
  ) values(
    v_uid,p_conversation_id,v_assigned_to,v_title,nullif(btrim(coalesce(p_description,'')),''),
    'open',v_priority,p_due_at,v_uid
  )
  returning * into v_task;

  return to_jsonb(v_task);
end;
$function$;

revoke all on function public.crm_operator_workspace_v1(uuid) from public,anon;
revoke all on function public.crm_operator_add_note_v1(uuid,text) from public,anon;
revoke all on function public.crm_operator_set_tag_v1(uuid,uuid,boolean) from public,anon;
revoke all on function public.crm_operator_create_task_v1(uuid,text,text,text,timestamptz) from public,anon;

grant execute on function public.crm_operator_workspace_v1(uuid) to authenticated;
grant execute on function public.crm_operator_add_note_v1(uuid,text) to authenticated;
grant execute on function public.crm_operator_set_tag_v1(uuid,uuid,boolean) to authenticated;
grant execute on function public.crm_operator_create_task_v1(uuid,text,text,text,timestamptz) to authenticated;
