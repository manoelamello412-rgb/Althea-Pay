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
set search_path = public
as $$
  with filtered as (
    select c.*, count(*) over () as total_count
    from public.crm_conversations c
    where c.user_id = auth.uid()
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
          select 1 from public.crm_messages m
          where m.user_id = c.user_id and m.conversation_id = c.id
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
  ), page as (
    select * from filtered
    order by updated_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,50),100))
  ), tail as (
    select updated_at, id from page order by updated_at asc, id asc limit 1
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'total_count' order by page.updated_at desc, page.id desc) from page), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100)) then jsonb_build_object('updated_at',(select updated_at from tail),'id',(select id from tail)) else null end,
    'total_count', coalesce((select max(total_count) from filtered),0)
  );
$$;

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
set search_path = public
as $$
  with filtered as (
    select m.* from public.crm_messages m
    where m.user_id = auth.uid() and m.conversation_id = p_conversation_id
      and (p_cursor_created_at is null or m.created_at < p_cursor_created_at or (m.created_at = p_cursor_created_at and m.id < p_cursor_id))
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limit,100),200)) + 1
  ), page as (
    select * from filtered order by created_at desc, id desc limit greatest(1, least(coalesce(p_limit,100),200))
  ), tail as (
    select created_at, id from page order by created_at asc, id asc limit 1
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200)) then jsonb_build_object('created_at',(select created_at from tail),'id',(select id from tail)) else null end
  );
$$;

revoke all on function public.crm_multicrm_conversations_page(integer,timestamptz,uuid,text,text,uuid,uuid,text) from public, anon;
grant execute on function public.crm_multicrm_conversations_page(integer,timestamptz,uuid,text,text,uuid,uuid,text) to authenticated;
revoke all on function public.crm_multicrm_messages_page(uuid,integer,timestamptz,uuid) from public, anon;
grant execute on function public.crm_multicrm_messages_page(uuid,integer,timestamptz,uuid) to authenticated;

create index if not exists crm_conversations_user_updated_id_desc_idx on public.crm_conversations (user_id, updated_at desc, id desc);
create index if not exists crm_messages_conversation_created_id_desc_idx on public.crm_messages (user_id, conversation_id, created_at desc, id desc);
