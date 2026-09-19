create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select p.default_organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.default_organization_id is not null
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = p.default_organization_id
        and om.user_id = auth.uid()
    )
  limit 1;
$function$;

revoke all on function private.current_organization_id() from public, anon;
grant execute on function private.current_organization_id() to authenticated;

drop policy if exists crm_conversations_owner on public.crm_conversations;
drop policy if exists crm_conversations_org_read on public.crm_conversations;
drop policy if exists crm_conversations_owner_insert on public.crm_conversations;
drop policy if exists crm_conversations_owner_update on public.crm_conversations;
drop policy if exists crm_conversations_owner_delete on public.crm_conversations;

create policy crm_conversations_org_read
on public.crm_conversations
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.has_org_capability(organization_id,'can_view_chats')
  and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(organization_id))
);

create policy crm_conversations_owner_insert
on public.crm_conversations
for insert
to authenticated
with check (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

create policy crm_conversations_owner_update
on public.crm_conversations
for update
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
)
with check (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

create policy crm_conversations_owner_delete
on public.crm_conversations
for delete
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

drop policy if exists crm_messages_owner on public.crm_messages;
drop policy if exists crm_messages_org_read on public.crm_messages;
drop policy if exists crm_messages_owner_insert on public.crm_messages;
drop policy if exists crm_messages_owner_update on public.crm_messages;
drop policy if exists crm_messages_owner_delete on public.crm_messages;

create policy crm_messages_org_read
on public.crm_messages
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.has_org_capability(organization_id,'can_view_chats')
  and created_at >= now() - make_interval(hours => private.org_operational_history_hours(organization_id))
);

create policy crm_messages_owner_insert
on public.crm_messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

create policy crm_messages_owner_update
on public.crm_messages
for update
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
)
with check (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

create policy crm_messages_owner_delete
on public.crm_messages
for delete
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
);

drop policy if exists crm_webhook_events_select on public.crm_webhook_events;
drop policy if exists crm_webhook_events_org_select on public.crm_webhook_events;

create policy crm_webhook_events_org_select
on public.crm_webhook_events
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.has_org_capability(organization_id,'can_view_values')
  and received_at >= now() - make_interval(hours => private.org_operational_history_hours(organization_id))
);

drop policy if exists crm_agents_org_select on public.crm_agents;
create policy crm_agents_org_select
on public.crm_agents
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.has_org_capability(organization_id,'can_view_chats')
);

drop policy if exists crm_teams_org_select on public.crm_teams;
create policy crm_teams_org_select
on public.crm_teams
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.has_org_capability(organization_id,'can_view_chats')
);

create or replace function public.crm_multicrm_conversations_page(
  p_limit integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_query text default null,
  p_filter text default 'all',
  p_agent_id uuid default null,
  p_team_id uuid default null,
  p_priority text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  with ctx as (
    select private.current_organization_id() as organization_id
  ),
  filtered as (
    select c.*, count(*) over () as total_count
    from public.crm_conversations c
    cross join ctx
    where ctx.organization_id is not null
      and c.organization_id = ctx.organization_id
      and private.has_org_capability(ctx.organization_id,'can_view_chats')
      and c.updated_at >= now() - make_interval(hours => private.org_operational_history_hours(ctx.organization_id))
      and (p_filter = 'all' or (p_filter = 'unread' and c.unread_count > 0) or (p_filter in ('open','pending','closed') and c.status = p_filter))
      and (p_agent_id is null or c.assigned_to = p_agent_id)
      and (p_team_id is null or c.metadata->>'team_id' = p_team_id::text)
      and (p_priority is null or c.priority = p_priority)
      and (
        nullif(trim(p_query), '') is null
        or c.buyer_name ilike '%' || trim(p_query) || '%'
        or c.buyer_email ilike '%' || trim(p_query) || '%'
        or c.customer_whatsapp ilike '%' || trim(p_query) || '%'
        or exists (
          select 1
          from public.crm_messages m
          where m.organization_id = c.organization_id
            and m.conversation_id = c.id
            and m.body ilike '%' || trim(p_query) || '%'
        )
      )
      and (
        p_cursor_updated_at is null
        or c.updated_at < p_cursor_updated_at
        or (c.updated_at = p_cursor_updated_at and c.id < p_cursor_id)
      )
    order by c.updated_at desc, c.id desc
    limit greatest(1, least(coalesce(p_limit,50),100)) + 1
  ),
  page as (
    select * from filtered
    order by updated_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,50),100))
  ),
  tail as (
    select updated_at, id
    from page
    order by updated_at asc, id asc
    limit 1
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'total_count' order by page.updated_at desc, page.id desc) from page), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100))
      then jsonb_build_object('updated_at',(select updated_at from tail),'id',(select id from tail))
      else null end,
    'total_count', coalesce((select max(total_count) from filtered),0)
  );
$function$;

create or replace function public.crm_multicrm_messages_page(
  p_conversation_id uuid,
  p_limit integer default 100,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  with ctx as (
    select private.current_organization_id() as organization_id
  ),
  filtered as (
    select m.*
    from public.crm_messages m
    cross join ctx
    where ctx.organization_id is not null
      and m.organization_id = ctx.organization_id
      and private.has_org_capability(ctx.organization_id,'can_view_chats')
      and m.created_at >= now() - make_interval(hours => private.org_operational_history_hours(ctx.organization_id))
      and m.conversation_id = p_conversation_id
      and exists (
        select 1
        from public.crm_conversations c
        where c.id=p_conversation_id
          and c.organization_id=ctx.organization_id
          and c.updated_at >= now() - make_interval(hours => private.org_operational_history_hours(ctx.organization_id))
      )
      and (
        p_cursor_created_at is null
        or m.created_at < p_cursor_created_at
        or (m.created_at = p_cursor_created_at and m.id < p_cursor_id)
      )
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limit,100),200)) + 1
  ),
  page as (
    select * from filtered
    order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,100),200))
  ),
  tail as (
    select created_at, id
    from page
    order by created_at asc, id asc
    limit 1
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200))
      then jsonb_build_object('created_at',(select created_at from tail),'id',(select id from tail))
      else null end
  );
$function$;

create or replace function public.crm_operator_mark_read(p_conversation_id uuid)
returns public.crm_conversations
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid:=private.current_organization_id();
  v_conversation public.crm_conversations;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));

  update public.crm_conversations
     set unread_count=0, updated_at=now()
   where id=p_conversation_id
     and organization_id=v_org
     and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(v_org))
  returning * into v_conversation;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  return v_conversation;
end;
$function$;

create or replace function public.crm_operator_set_status(p_conversation_id uuid, p_status text)
returns public.crm_conversations
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid:=private.current_organization_id();
  v_conversation public.crm_conversations;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_status not in ('open','pending','closed') then
    raise exception 'INVALID_STATUS' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));

  update public.crm_conversations
     set status=p_status, updated_at=now()
   where id=p_conversation_id
     and organization_id=v_org
     and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(v_org))
  returning * into v_conversation;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  return v_conversation;
end;
$function$;

create or replace function public.crm_assign_conversation(
  p_conversation_id uuid,
  p_agent_id uuid default null,
  p_team_id uuid default null,
  p_priority text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid:=private.current_organization_id();
  v jsonb;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));

  if not exists(
    select 1
    from public.crm_conversations
    where id=p_conversation_id
      and organization_id=v_org
      and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(v_org))
  ) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  if p_agent_id is not null and not exists(
    select 1 from public.crm_agents
    where id=p_agent_id and organization_id=v_org
  ) then
    raise exception 'AGENT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_team_id is not null and not exists(
    select 1 from public.crm_teams
    where id=p_team_id and organization_id=v_org and active
  ) then
    raise exception 'TEAM_NOT_FOUND' using errcode='P0002';
  end if;

  if p_agent_id is not null and p_team_id is not null and not exists(
    select 1 from public.crm_team_members
    where organization_id=v_org
      and team_id=p_team_id
      and agent_id=p_agent_id
      and active
  ) then
    raise exception 'AGENT_TEAM_MISMATCH' using errcode='23514';
  end if;

  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then
    raise exception 'INVALID_PRIORITY' using errcode='22023';
  end if;

  update public.crm_conversations
     set assigned_to=p_agent_id,
         priority=coalesce(p_priority,priority),
         updated_at=now(),
         metadata=case
           when p_team_id is null then coalesce(metadata,'{}'::jsonb)-'team_id'
           else jsonb_set(coalesce(metadata,'{}'::jsonb),'{team_id}',to_jsonb(p_team_id::text),true)
         end
   where id=p_conversation_id
     and organization_id=v_org
  returning jsonb_build_object(
    'id',id,
    'assigned_to',assigned_to,
    'priority',priority,
    'team_id',metadata->>'team_id',
    'updated_at',updated_at
  ) into v;

  return v;
end;
$function$;

create or replace function public.crm_operator_send_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id text default null
)
returns public.crm_messages
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid:=auth.uid();
  v_org uuid:=private.current_organization_id();
  v_body text:=btrim(coalesce(p_body,''));
  c public.crm_conversations%rowtype;
  a public.crm_channel_accounts%rowtype;
  v_message public.crm_messages;
  outbox_id uuid;
  idem text;
  client_id text:=nullif(trim(p_client_message_id),'');
begin
  if v_actor is null or v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if v_body='' then
    raise exception 'MESSAGE_EMPTY' using errcode='22023';
  end if;
  if length(v_body)>10000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode='22001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));

  select *
    into c
  from public.crm_conversations
  where id=p_conversation_id
    and organization_id=v_org
    and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(v_org))
  for update;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  if client_id is null then
    client_id:='operator:'||c.id::text||':'||encode(extensions.digest(v_body||now()::text,'sha256'),'hex');
  end if;

  select *
    into v_message
  from public.crm_messages
  where organization_id=v_org
    and user_id=c.user_id
    and client_message_id=client_id
  limit 1;

  if found then
    return v_message;
  end if;

  if coalesce(c.primary_channel,'funnel_chat')='funnel_chat' then
    idem:='operator:'||c.id::text||':'||client_id;

    insert into public.crm_channel_message_outbox(
      user_id,conversation_id,channel_account_id,channel,external_message_id,
      idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata
    )
    values(
      c.user_id,c.id,null,'funnel_chat',null,idem,'outbound',v_body,'queued',5,now(),
      jsonb_build_object('source','crm_operator','client_message_id',client_id,'actor_id',v_actor)
    )
    on conflict(user_id,idempotency_key) do update set updated_at=now()
    returning id into outbox_id;

    insert into public.crm_messages(
      conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id
    )
    values(
      c.id,c.user_id,'outbound','funnel_chat',v_body,
      jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued','actor_id',v_actor),
      v_actor,client_id
    )
    on conflict(user_id,client_message_id) where client_message_id is not null do nothing
    returning * into v_message;

    if v_message.id is null then
      select * into v_message
      from public.crm_messages
      where organization_id=v_org
        and user_id=c.user_id
        and client_message_id=client_id
      limit 1;
    end if;

    return v_message;
  end if;

  if c.channel_account_id is null or c.channel_account_id='' then
    raise exception 'CHANNEL_ACCOUNT_REQUIRED';
  end if;

  select *
    into a
  from public.crm_channel_accounts
  where id=c.channel_account_id::uuid
    and organization_id=v_org
    and channel=c.primary_channel
    and status='active'
  for update;

  if not found then
    raise exception 'CHANNEL_ACCOUNT_NOT_FOUND_OR_INACTIVE';
  end if;

  idem:='operator:'||c.id::text||':'||client_id;

  insert into public.crm_channel_message_outbox(
    user_id,conversation_id,channel_account_id,channel,external_message_id,
    idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata
  )
  values(
    c.user_id,c.id,a.id,c.primary_channel,null,idem,'outbound',v_body,'queued',5,now(),
    jsonb_build_object('source','crm_operator','client_message_id',client_id,'actor_id',v_actor)
  )
  on conflict(user_id,idempotency_key) do update set updated_at=now()
  returning id into outbox_id;

  insert into public.crm_messages(
    conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id,provider,channel_account_id
  )
  values(
    c.id,c.user_id,'outbound',c.primary_channel,v_body,
    jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued','actor_id',v_actor),
    v_actor,client_id,a.provider,a.id::text
  )
  on conflict(user_id,client_message_id) where client_message_id is not null do nothing
  returning * into v_message;

  if v_message.id is null then
    select * into v_message
    from public.crm_messages
    where organization_id=v_org
      and user_id=c.user_id
      and client_message_id=client_id
    limit 1;
  end if;

  return v_message;
end;
$function$;
