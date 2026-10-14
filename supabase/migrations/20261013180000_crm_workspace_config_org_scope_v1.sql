-- Organization scope for CRM tasks, tags, quick replies and channel accounts,
-- which so far were readable and writable only by the organization owner.
-- Members read through RLS by capability; writes go through audited RPCs.
-- Rows stay attributed to the organization owner (user_id) because workers
-- (automation-engine-v2, outbox dispatcher, checkout recovery) key on it.
--   tasks:                 read can_view_chats, write can_reply_chats
--   tags, quick replies:   read can_view_chats, write can_manage_automations
--   channel accounts:      read/write can_manage_integrations (name and status only;
--                          credentials_ref and metadata stay server-managed)

drop policy if exists crm_tasks_owner on public.crm_tasks;
drop policy if exists crm_tags_owner on public.crm_tags;
drop policy if exists crm_quick_replies_owner on public.crm_quick_replies;
drop policy if exists crm_channel_accounts_owner on public.crm_channel_accounts;

create policy crm_tasks_org_select on public.crm_tasks for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
create policy crm_tags_org_select on public.crm_tags for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
create policy crm_quick_replies_org_select on public.crm_quick_replies for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
create policy crm_channel_accounts_org_select on public.crm_channel_accounts for select to authenticated using (private.has_org_capability(organization_id, 'can_manage_integrations'));

revoke insert, update, delete on public.crm_tasks, public.crm_tags, public.crm_quick_replies, public.crm_channel_accounts from anon, authenticated;
grant select on public.crm_tasks, public.crm_tags, public.crm_quick_replies, public.crm_channel_accounts to authenticated;
alter publication supabase_realtime add table public.crm_tasks;

create or replace function private.organization_owner_id(target_org uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select user_id from public.organization_members
   where organization_id = target_org and role = 'owner'
   order by user_id
   limit 1
$function$;
revoke all on function private.organization_owner_id(uuid) from public, anon, authenticated;

create or replace function private.crm_config_context(requested_capability text)
returns table(organization_id uuid, owner_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.has_org_capability(v_org, requested_capability) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  organization_id := v_org;
  owner_id := private.organization_owner_id(v_org);
  if owner_id is null then raise exception 'ORGANIZATION_OWNER_MISSING' using errcode='23514'; end if;
  return next;
end;
$function$;
revoke all on function private.crm_config_context(text) from public, anon, authenticated;

create or replace function public.crm_tag_save(p_id uuid, p_name text, p_description text default null, p_active boolean default true)
returns public.crm_tags
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_name text := btrim(coalesce(p_name, ''));
  v_tag public.crm_tags;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if v_name = '' or length(v_name) > 60 then raise exception 'TAG_NAME_INVALID' using errcode='22023'; end if;
  if length(coalesce(p_description, '')) > 500 then raise exception 'TAG_DESCRIPTION_TOO_LONG' using errcode='22001'; end if;
  begin
    if p_id is null then
      insert into public.crm_tags(user_id, organization_id, name, description, active)
      values (c.owner_id, c.organization_id, v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_active, true))
      returning * into v_tag;
    else
      update public.crm_tags
         set name = v_name, description = nullif(btrim(coalesce(p_description, '')), ''), active = coalesce(p_active, true), updated_at = now()
       where id = p_id and organization_id = c.organization_id
      returning * into v_tag;
      if not found then raise exception 'TAG_NOT_FOUND' using errcode='P0002'; end if;
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN' using errcode='23505';
  end;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.tag.saved', 'crm_tag', v_tag.id::text, jsonb_build_object('name', v_tag.name, 'active', v_tag.active));
  return v_tag;
end;
$function$;

create or replace function public.crm_quick_reply_save(p_id uuid, p_title text, p_body text, p_channel text default 'all', p_active boolean default true)
returns public.crm_quick_replies
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_channel text := lower(btrim(coalesce(p_channel, 'all')));
  v_reply public.crm_quick_replies;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if v_title = '' or length(v_title) > 80 then raise exception 'QUICK_REPLY_TITLE_INVALID' using errcode='22023'; end if;
  if v_body = '' or length(v_body) > 4000 then raise exception 'QUICK_REPLY_BODY_INVALID' using errcode='22023'; end if;
  if v_channel not in ('all', 'funnel_chat', 'whatsapp', 'instagram', 'messenger', 'email', 'sms') then raise exception 'INVALID_CHANNEL' using errcode='22023'; end if;
  begin
    if p_id is null then
      insert into public.crm_quick_replies(user_id, organization_id, title, body, channel, active)
      values (c.owner_id, c.organization_id, v_title, v_body, v_channel, coalesce(p_active, true))
      returning * into v_reply;
    else
      update public.crm_quick_replies
         set title = v_title, body = v_body, channel = v_channel, active = coalesce(p_active, true), updated_at = now()
       where id = p_id and organization_id = c.organization_id
      returning * into v_reply;
      if not found then raise exception 'QUICK_REPLY_NOT_FOUND' using errcode='P0002'; end if;
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN' using errcode='23505';
  end;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.quick_reply.saved', 'crm_quick_reply', v_reply.id::text, jsonb_build_object('title', v_reply.title, 'channel', v_reply.channel, 'active', v_reply.active));
  return v_reply;
end;
$function$;

create or replace function public.crm_task_save(
  p_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_assigned_to uuid default null,
  p_conversation_id uuid default null
)
returns public.crm_tasks
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_title text := btrim(coalesce(p_title, ''));
  v_priority text := lower(btrim(coalesce(p_priority, 'normal')));
  v_task public.crm_tasks;
begin
  select * into c from private.crm_config_context('can_reply_chats');
  if v_title = '' or length(v_title) > 200 then raise exception 'TASK_TITLE_INVALID' using errcode='22023'; end if;
  if length(coalesce(p_description, '')) > 5000 then raise exception 'TASK_DESCRIPTION_TOO_LONG' using errcode='22001'; end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'INVALID_PRIORITY' using errcode='22023'; end if;
  if p_assigned_to is not null and not exists (select 1 from public.organization_members where organization_id = c.organization_id and user_id = p_assigned_to) then
    raise exception 'ASSIGNEE_NOT_MEMBER' using errcode='22023';
  end if;
  if p_conversation_id is not null and not exists (select 1 from public.crm_conversations where id = p_conversation_id and organization_id = c.organization_id) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  if p_id is null then
    insert into public.crm_tasks(user_id, organization_id, conversation_id, assigned_to, title, description, status, priority, due_at, created_by)
    values (c.owner_id, c.organization_id, p_conversation_id, p_assigned_to, v_title, nullif(btrim(coalesce(p_description, '')), ''), 'open', v_priority, p_due_at, auth.uid())
    returning * into v_task;
  else
    update public.crm_tasks
       set title = v_title, description = nullif(btrim(coalesce(p_description, '')), ''), priority = v_priority,
           due_at = p_due_at, assigned_to = p_assigned_to, conversation_id = p_conversation_id, updated_at = now()
     where id = p_id and organization_id = c.organization_id
    returning * into v_task;
    if not found then raise exception 'TASK_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.task.saved', 'crm_task', v_task.id::text,
          jsonb_build_object('title', v_task.title, 'priority', v_task.priority, 'assigned_to', v_task.assigned_to, 'due_at', v_task.due_at));
  return v_task;
end;
$function$;

create or replace function public.crm_task_set_status(p_id uuid, p_status text)
returns public.crm_tasks
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_task public.crm_tasks;
  v_from text;
begin
  select * into c from private.crm_config_context('can_reply_chats');
  if p_status not in ('open', 'in_progress', 'completed', 'cancelled') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  select status into v_from from public.crm_tasks where id = p_id and organization_id = c.organization_id for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode='P0002'; end if;
  update public.crm_tasks
     set status = p_status,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
         updated_at = now()
   where id = p_id
  returning * into v_task;
  if v_from is distinct from p_status then
    insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
    values (c.owner_id, auth.uid(), c.organization_id, 'crm.task.status_changed', 'crm_task', v_task.id::text, jsonb_build_object('from', v_from, 'to', p_status));
  end if;
  return v_task;
end;
$function$;

create or replace function public.crm_channel_account_update(p_id uuid, p_display_name text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_account public.crm_channel_accounts;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if p_status not in ('active', 'inactive') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  if length(coalesce(p_display_name, '')) > 120 then raise exception 'DISPLAY_NAME_TOO_LONG' using errcode='22001'; end if;
  update public.crm_channel_accounts
     set display_name = nullif(btrim(coalesce(p_display_name, '')), ''), status = p_status, updated_at = now()
   where id = p_id and organization_id = c.organization_id
  returning * into v_account;
  if not found then raise exception 'CHANNEL_ACCOUNT_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.channel_account.updated', 'crm_channel_account', v_account.id::text, jsonb_build_object('status', v_account.status, 'display_name', v_account.display_name));
  return jsonb_build_object('id', v_account.id, 'channel', v_account.channel, 'provider', v_account.provider, 'display_name', v_account.display_name, 'status', v_account.status, 'updated_at', v_account.updated_at);
end;
$function$;

revoke all on function public.crm_tag_save(uuid, text, text, boolean) from public, anon;
revoke all on function public.crm_quick_reply_save(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.crm_task_save(uuid, text, text, text, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.crm_task_set_status(uuid, text) from public, anon;
revoke all on function public.crm_channel_account_update(uuid, text, text) from public, anon;
grant execute on function public.crm_tag_save(uuid, text, text, boolean) to authenticated;
grant execute on function public.crm_quick_reply_save(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.crm_task_save(uuid, text, text, text, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.crm_task_set_status(uuid, text) to authenticated;
grant execute on function public.crm_channel_account_update(uuid, text, text) to authenticated;
