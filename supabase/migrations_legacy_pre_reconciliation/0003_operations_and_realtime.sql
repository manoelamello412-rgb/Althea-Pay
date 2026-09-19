-- ALTHEA CORE 0003
-- Operational primitives: safe gateway switching, chat timestamps, audit trail and Realtime.

create or replace function public.set_active_funnel_gateway(
  target_funnel uuid,
  target_gateway uuid
)
returns public.funnel_gateway_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  result_row public.funnel_gateway_connections;
begin
  select organization_id into target_org
  from public.funnels
  where id = target_funnel;

  if target_org is null then
    raise exception 'FUNNEL_NOT_FOUND';
  end if;

  if not public.has_org_role(target_org, array['owner','admin','manager']::public.member_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.gateway_connections g
    where g.id = target_gateway
      and g.organization_id = target_org
      and g.status = 'connected'
  ) then
    raise exception 'GATEWAY_NOT_CONNECTED';
  end if;

  if not exists (
    select 1
    from public.funnel_gateway_connections fg
    where fg.funnel_id = target_funnel
      and fg.gateway_connection_id = target_gateway
  ) then
    insert into public.funnel_gateway_connections (funnel_id, gateway_connection_id)
    values (target_funnel, target_gateway);
  end if;

  update public.funnel_gateway_connections
  set is_active = false,
      activated_at = null
  where funnel_id = target_funnel
    and is_active = true;

  update public.funnel_gateway_connections
  set is_active = true,
      activated_at = now()
  where funnel_id = target_funnel
    and gateway_connection_id = target_gateway
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function public.set_active_funnel_gateway(uuid, uuid) from public;
grant execute on function public.set_active_funnel_gateway(uuid, uuid) to authenticated;

create or replace function public.touch_chat_conversation()
returns trigger
language plpgsql
as $$
begin
  update public.chat_conversations
  set last_message_at = new.created_at,
      updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_message_touch_conversation on public.chat_messages;
create trigger chat_message_touch_conversation
after insert on public.chat_messages
for each row execute function public.touch_chat_conversation();

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_org uuid;
  row_id uuid;
begin
  if TG_OP = 'DELETE' then
    row_id := OLD.id;
    begin
      row_org := OLD.organization_id;
    exception when undefined_column then
      row_org := null;
    end;
  else
    row_id := NEW.id;
    begin
      row_org := NEW.organization_id;
    exception when undefined_column then
      row_org := null;
    end;
  end if;

  if row_org is not null then
    insert into public.audit_logs (
      organization_id,
      actor_user_id,
      action,
      resource_type,
      resource_id,
      details
    ) values (
      row_org,
      auth.uid(),
      lower(TG_OP),
      TG_TABLE_NAME,
      row_id,
      jsonb_build_object('source', 'database_trigger')
    );
  end if;

  return coalesce(NEW, OLD);
end;
$$;

-- Audit only operator-controlled resources. Sales/events are ingested by trusted server paths.
drop trigger if exists funnels_audit on public.funnels;
create trigger funnels_audit
after insert or update or delete on public.funnels
for each row execute function public.audit_row_change();

drop trigger if exists gateways_audit on public.gateway_connections;
create trigger gateways_audit
after insert or update or delete on public.gateway_connections
for each row execute function public.audit_row_change();

drop trigger if exists products_audit on public.products;
create trigger products_audit
after insert or update or delete on public.products
for each row execute function public.audit_row_change();

drop trigger if exists chats_audit on public.chat_conversations;
create trigger chats_audit
after insert or update or delete on public.chat_conversations
for each row execute function public.audit_row_change();

-- Enable Realtime only for operational streams. The client still requires authenticated RLS access.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_conversations' and schemaname = 'public'
  ) then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages' and schemaname = 'public'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sales' and schemaname = 'public'
  ) then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;
