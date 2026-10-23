-- Chat list like WhatsApp: newest message first, with a preview of that message.
-- Order (and the keyset cursor) is the last message time, falling back to updated_at for conversations
-- without messages. The cursor keeps its name (p_cursor_updated_at / next_cursor.updated_at) so the
-- screen contract does not change; it now carries that sort time.

CREATE OR REPLACE FUNCTION public.crm_multicrm_conversations_page(p_limit integer DEFAULT 50, p_cursor_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_filter text DEFAULT 'all'::text, p_agent_id uuid DEFAULT NULL::uuid, p_team_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with ctx as (
    select
      private.current_organization_id() as organization_id
  ),
  access as (
    select
      organization_id,
      private.has_org_capability(organization_id,'can_view_chats') as can_view_chats,
      private.has_org_capability(organization_id,'can_view_values') as can_view_values,
      private.has_org_capability(organization_id,'can_view_customers') as can_view_customers,
      private.has_org_capability(organization_id,'can_manage_gateways') as can_manage_gateways,
      private.org_operational_history_hours(organization_id) as history_hours
    from ctx
    where organization_id is not null
  ),
  filtered as (
    select c.*, coalesce(c.last_message_at, c.updated_at) as sort_at, a.can_view_values, a.can_view_customers, a.can_manage_gateways,
           count(*) over () as total_count
    from public.crm_conversations c
    cross join access a
    where a.can_view_chats
      and c.organization_id = a.organization_id
      and c.updated_at >= now() - make_interval(hours => a.history_hours)
      and (p_filter = 'all' or (p_filter = 'unread' and c.unread_count > 0) or (p_filter in ('open','pending','closed') and c.status = p_filter))
      and (p_agent_id is null or c.assigned_to = p_agent_id)
      and (p_team_id is null or c.metadata->>'team_id' = p_team_id::text)
      and (p_priority is null or c.priority = p_priority)
      and (
        nullif(trim(p_query), '') is null
        or (a.can_view_customers and c.buyer_name ilike '%' || trim(p_query) || '%')
        or (a.can_view_customers and c.buyer_email ilike '%' || trim(p_query) || '%')
        or (a.can_view_customers and c.customer_whatsapp ilike '%' || trim(p_query) || '%')
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
        or coalesce(c.last_message_at, c.updated_at) < p_cursor_updated_at
        or (coalesce(c.last_message_at, c.updated_at) = p_cursor_updated_at and c.id < p_cursor_id)
      )
    order by coalesce(c.last_message_at, c.updated_at) desc, c.id desc
    limit greatest(1, least(coalesce(p_limit,50),100)) + 1
  ),
  page as (
    select * from filtered
    order by sort_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,50),100))
  ),
  tail as (
    select sort_at, id
    from page
    order by sort_at asc, id asc
    limit 1
  )
  select jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        (
          to_jsonb(page)
          - 'total_count'
          - 'can_view_values'
          - 'can_view_customers'
          - 'can_manage_gateways'
          - 'public_token'
          - 'sort_at'
        )
        || jsonb_build_object(
          'buyer_name', case when page.can_view_customers then page.buyer_name else null end,
          'buyer_email', case when page.can_view_customers then page.buyer_email else null end,
          'customer_whatsapp', case when page.can_view_customers then page.customer_whatsapp else null end,
          'customer_id', case when page.can_view_customers then page.customer_id else null end,
          'metadata', private.redact_crm_metadata(page.metadata, page.can_view_values, page.can_view_customers),
          'gateway_error_log', case when page.can_manage_gateways then page.gateway_error_log else null end,
          'last_message_preview', (select left(coalesce(nullif(btrim(m.body), ''), case when m.metadata ? 'attachment' then '📎 Anexo' end), 140)
                                     from public.crm_messages m
                                    where m.organization_id = page.organization_id and m.conversation_id = page.id
                                    order by m.created_at desc limit 1)
        )
        order by page.sort_at desc, page.id desc
      )
      from page
    ), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,50),100))
      then jsonb_build_object('updated_at',(select sort_at from tail),'id',(select id from tail))
      else null end,
    'total_count', coalesce((select max(total_count) from filtered),0)
  );
$function$;
