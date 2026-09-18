create unique index if not exists crm_conversations_remote_api_thread_uidx
  on public.crm_conversations(
    user_id,
    funnel_id,
    ((metadata->>'remote_conversation_id'))
  )
  where primary_channel='funnel_chat'
    and status in ('open','pending')
    and coalesce(metadata->>'delivery_mode','')='remote_api'
    and nullif(metadata->>'remote_conversation_id','') is not null;

create or replace function public.crm_ingest_funnel_chat_message(
  p_user_id uuid,
  p_funnel_id text,
  p_remote_conversation_id text,
  p_body text,
  p_external_message_id text,
  p_buyer_name text default null,
  p_buyer_email text default null,
  p_customer_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_remote_conversation_id text:=nullif(trim(p_remote_conversation_id),'');
  v_body text:=btrim(coalesce(p_body,''));
  v_external_message_id text:=nullif(trim(p_external_message_id),'');
  v_email text:=lower(nullif(trim(p_buyer_email),''));
  v_name text:=nullif(trim(p_buyer_name),'');
  v_customer_id text:=nullif(trim(p_customer_id),'');
  v_conversation public.crm_conversations%rowtype;
  v_message public.crm_messages%rowtype;
  v_metadata jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  if p_user_id is null then raise exception 'user_id_required' using errcode='22023'; end if;
  if nullif(trim(p_funnel_id),'') is null then raise exception 'funnel_id_required' using errcode='22023'; end if;
  if v_remote_conversation_id is null or length(v_remote_conversation_id)>255 then
    raise exception 'remote_conversation_id_invalid' using errcode='22023';
  end if;
  if v_body='' or length(v_body)>10000 then
    raise exception 'message_body_invalid' using errcode='22023';
  end if;
  if v_external_message_id is null or length(v_external_message_id)>255 then
    raise exception 'external_message_id_invalid' using errcode='22023';
  end if;

  if not exists(
    select 1
    from public.funnels f
    where f.id=p_funnel_id
      and f.user_id=p_user_id
      and f.deleted_at is null
  ) then
    raise exception 'funnel_not_found' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text||':'||p_funnel_id||':'||v_remote_conversation_id,0)
  );

  select * into v_message
  from public.crm_messages
  where user_id=p_user_id
    and provider='funnel_chat'
    and external_message_id=v_external_message_id
  limit 1;

  if found then
    return jsonb_build_object(
      'conversation_id',v_message.conversation_id,
      'message_id',v_message.id,
      'deduplicated',true
    );
  end if;

  select * into v_conversation
  from public.crm_conversations c
  where c.user_id=p_user_id
    and c.funnel_id=p_funnel_id
    and c.primary_channel='funnel_chat'
    and c.status in ('open','pending')
    and c.metadata->>'delivery_mode'='remote_api'
    and c.metadata->>'remote_conversation_id'=v_remote_conversation_id
  order by c.updated_at desc
  limit 1
  for update;

  if not found and v_email is not null then
    select * into v_conversation
    from public.crm_conversations c
    where c.user_id=p_user_id
      and c.funnel_id=p_funnel_id
      and lower(c.buyer_email)=v_email
      and c.status in ('open','pending')
    order by c.updated_at desc
    limit 1
    for update;
  end if;

  if not found and v_customer_id is not null then
    select * into v_conversation
    from public.crm_conversations c
    where c.user_id=p_user_id
      and c.funnel_id=p_funnel_id
      and c.customer_id=v_customer_id
      and c.status in ('open','pending')
    order by c.updated_at desc
    limit 1
    for update;
  end if;

  if v_conversation.id is null then
    insert into public.crm_conversations(
      user_id,
      funnel_id,
      buyer_name,
      buyer_email,
      customer_id,
      status,
      priority,
      primary_channel,
      metadata
    )
    values(
      p_user_id,
      p_funnel_id,
      v_name,
      v_email,
      v_customer_id,
      'open',
      'normal',
      'funnel_chat',
      v_metadata||jsonb_build_object(
        'source','funnel_remote_api',
        'delivery_mode','remote_api',
        'remote_conversation_id',v_remote_conversation_id
      )
    )
    returning * into v_conversation;
  else
    update public.crm_conversations
    set funnel_id=p_funnel_id,
        buyer_name=coalesce(buyer_name,v_name),
        buyer_email=coalesce(buyer_email,v_email),
        customer_id=coalesce(customer_id,v_customer_id),
        primary_channel='funnel_chat',
        metadata=coalesce(metadata,'{}'::jsonb)||v_metadata||jsonb_build_object(
          'source','funnel_remote_api',
          'delivery_mode','remote_api',
          'remote_conversation_id',v_remote_conversation_id
        ),
        updated_at=now()
    where id=v_conversation.id
      and user_id=p_user_id
    returning * into v_conversation;
  end if;

  insert into public.crm_messages(
    conversation_id,
    user_id,
    direction,
    channel,
    body,
    metadata,
    provider,
    external_message_id
  )
  values(
    v_conversation.id,
    p_user_id,
    'inbound',
    'funnel_chat',
    v_body,
    v_metadata||jsonb_build_object(
      'source','funnel_remote_api',
      'remote_conversation_id',v_remote_conversation_id,
      'funnel_id',p_funnel_id
    ),
    'funnel_chat',
    v_external_message_id
  )
  returning * into v_message;

  return jsonb_build_object(
    'conversation_id',v_conversation.id,
    'message_id',v_message.id,
    'deduplicated',false
  );
exception
  when unique_violation then
    select * into v_message
    from public.crm_messages
    where user_id=p_user_id
      and provider='funnel_chat'
      and external_message_id=v_external_message_id
    limit 1;

    if v_message.id is not null then
      return jsonb_build_object(
        'conversation_id',v_message.conversation_id,
        'message_id',v_message.id,
        'deduplicated',true
      );
    end if;
    raise;
end;
$$;

revoke all on function public.crm_ingest_funnel_chat_message(uuid,text,text,text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.crm_ingest_funnel_chat_message(uuid,text,text,text,text,text,text,text,jsonb)
  to service_role;

grant select on public.crm_channel_accounts to service_role;
grant select on public.crm_channel_identities to service_role;
grant select,update on public.crm_channel_message_outbox to service_role;
grant select,insert,update on public.crm_messages to service_role;
grant select on public.crm_conversations to service_role;
