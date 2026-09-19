create or replace function private.redact_crm_metadata(
  input jsonb,
  allow_values boolean,
  allow_customers boolean
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  result jsonb;
  key text;
  value jsonb;
  item jsonb;
  customer_keys constant text[] := array[
    'customer','buyer','contact','customer_name','buyer_name','full_name',
    'email','buyer_email','customer_email','phone','mobile','whatsapp',
    'customer_whatsapp','cpf','cnpj','document','document_number','address'
  ];
  financial_keys constant text[] := array[
    'amount','currency','value','price','total','subtotal','revenue','gross',
    'net','fee','fees','tax','taxes','discount','balance','transaction_amount',
    'payment_amount','order_total','unit_amount'
  ];
begin
  if input is null then
    return null;
  end if;

  case jsonb_typeof(input)
    when 'object' then
      result := '{}'::jsonb;
      for key, value in select * from jsonb_each(input)
      loop
        if (not allow_customers and lower(key) = any(customer_keys))
           or (not allow_values and lower(key) = any(financial_keys)) then
          continue;
        end if;
        result := result || jsonb_build_object(
          key,
          private.redact_crm_metadata(value, allow_values, allow_customers)
        );
      end loop;
      return result;

    when 'array' then
      result := '[]'::jsonb;
      for item in select value from jsonb_array_elements(input)
      loop
        result := result || jsonb_build_array(
          private.redact_crm_metadata(item, allow_values, allow_customers)
        );
      end loop;
      return result;

    else
      return input;
  end case;
end;
$function$;

revoke all on function private.redact_crm_metadata(jsonb,boolean,boolean)
  from public, anon, authenticated;

drop policy if exists crm_conversations_org_read on public.crm_conversations;
drop policy if exists crm_conversations_owner_read on public.crm_conversations;

create policy crm_conversations_owner_read
on public.crm_conversations
for select
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
  and updated_at >= now() - make_interval(hours => private.org_operational_history_hours(organization_id))
);

drop policy if exists crm_messages_org_read on public.crm_messages;
drop policy if exists crm_messages_owner_read on public.crm_messages;

create policy crm_messages_owner_read
on public.crm_messages
for select
to authenticated
using (
  user_id = auth.uid()
  and organization_id = private.current_organization_id()
  and created_at >= now() - make_interval(hours => private.org_operational_history_hours(organization_id))
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
security definer
set search_path = pg_catalog, public, private
as $function$
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
    select c.*, a.can_view_values, a.can_view_customers, a.can_manage_gateways,
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
        )
        || jsonb_build_object(
          'buyer_name', case when page.can_view_customers then page.buyer_name else null end,
          'buyer_email', case when page.can_view_customers then page.buyer_email else null end,
          'customer_whatsapp', case when page.can_view_customers then page.customer_whatsapp else null end,
          'customer_id', case when page.can_view_customers then page.customer_id else null end,
          'metadata', private.redact_crm_metadata(page.metadata, page.can_view_values, page.can_view_customers),
          'gateway_error_log', case when page.can_manage_gateways then page.gateway_error_log else null end
        )
        order by page.updated_at desc, page.id desc
      )
      from page
    ), '[]'::jsonb),
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
security definer
set search_path = pg_catalog, public, private
as $function$
  with ctx as (
    select private.current_organization_id() as organization_id
  ),
  access as (
    select
      organization_id,
      private.has_org_capability(organization_id,'can_view_chats') as can_view_chats,
      private.has_org_capability(organization_id,'can_view_values') as can_view_values,
      private.has_org_capability(organization_id,'can_view_customers') as can_view_customers,
      private.org_operational_history_hours(organization_id) as history_hours
    from ctx
    where organization_id is not null
  ),
  filtered as (
    select m.*, a.can_view_values, a.can_view_customers
    from public.crm_messages m
    cross join access a
    where a.can_view_chats
      and m.organization_id = a.organization_id
      and m.created_at >= now() - make_interval(hours => a.history_hours)
      and m.conversation_id = p_conversation_id
      and exists (
        select 1
        from public.crm_conversations c
        where c.id=p_conversation_id
          and c.organization_id=a.organization_id
          and c.updated_at >= now() - make_interval(hours => a.history_hours)
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
    'items',
    coalesce((
      select jsonb_agg(
        (
          to_jsonb(page)
          - 'can_view_values'
          - 'can_view_customers'
        )
        || jsonb_build_object(
          'metadata', private.redact_crm_metadata(page.metadata, page.can_view_values, page.can_view_customers)
        )
        order by page.created_at desc, page.id desc
      )
      from page
    ), '[]'::jsonb),
    'has_more', (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200)),
    'next_cursor', case when (select count(*) from filtered) > greatest(1, least(coalesce(p_limit,100),200))
      then jsonb_build_object('created_at',(select created_at from tail),'id',(select id from tail))
      else null end
  );
$function$;
