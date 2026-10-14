-- CRM board + call desk v1.
-- Kanban cards get an owner (responsável), tasks get a customer, and three read RPCs serve
-- the board, the call queue and the call context already aggregated, so the screens only render.
--   board / queue / call context: can_view_customers
--     tags, tasks, conversations: also can_view_chats
--     transaction amounts:        also can_view_values
--   assign card owner: can_view_customers + can_reply_chats (same as moving a card)

alter table public.crm_pipeline_cards add column if not exists owner_id uuid references auth.users(id) on delete set null;
create index if not exists crm_pipeline_cards_owner_idx on public.crm_pipeline_cards(organization_id, owner_id);

alter table public.crm_tasks add column if not exists client_id text references public.clients(id) on delete set null;
create index if not exists crm_tasks_client_open_idx on public.crm_tasks(organization_id, client_id) where status in ('open', 'in_progress');
update public.crm_tasks t
   set client_id = c.customer_id
  from public.crm_conversations c
 where t.client_id is null and t.conversation_id = c.id and c.customer_id is not null;

-- First non-empty value among keys, at the top level or under customer/buyer/profile (same lookup the screens used).
create or replace function private.client_field(p_data jsonb, p_keys text[])
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select v from (
    select nullif(btrim(coalesce(p_data, '{}'::jsonb) #>> (case when parent is null then array[k] else array[parent, k] end)), '') as v, po, ko
      from unnest(array[null, 'customer', 'buyer', 'profile']) with ordinality as p(parent, po),
           unnest(p_keys) with ordinality as kk(k, ko)
  ) x where v is not null order by po, ko limit 1
$function$;
revoke all on function private.client_field(jsonb, text[]) from public, anon, authenticated;

create or replace function private.client_card_json(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, private
as $function$
  select jsonb_build_object(
    'name', private.client_field(p_data, array['name', 'full_name', 'nome', 'customer_name', 'buyer_name']),
    'email', private.client_field(p_data, array['email', 'buyer_email', 'customer_email']),
    'phone', private.client_field(p_data, array['phone_e164', 'phone', 'whatsapp', 'mobile', 'telefone', 'celular', 'phone_number'])
  )
$function$;
revoke all on function private.client_card_json(jsonb) from public, anon, authenticated;

create or replace function private.org_members_json(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.display_name, 'role', m.role) order by p.display_name nulls last, m.user_id), '[]'::jsonb)
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
   where m.organization_id = p_org
$function$;
revoke all on function private.org_members_json(uuid) from public, anon, authenticated;

create or replace function public.crm_card_assign(p_card_id uuid, p_owner_id uuid, p_expected_version integer)
returns public.crm_pipeline_cards
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_card public.crm_pipeline_cards;
  v_from uuid;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not (private.has_org_capability(v_org, 'can_view_customers') and private.has_org_capability(v_org, 'can_reply_chats')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select * into v_card from public.crm_pipeline_cards where id = p_card_id and organization_id = v_org for update;
  if not found then raise exception 'CARD_NOT_FOUND' using errcode='P0002'; end if;
  if v_card.version <> p_expected_version then raise exception 'CARD_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_owner_id is not null and not exists (select 1 from public.organization_members where organization_id = v_org and user_id = p_owner_id) then
    raise exception 'OWNER_NOT_MEMBER' using errcode='22023';
  end if;
  if v_card.owner_id is not distinct from p_owner_id then return v_card; end if;

  v_from := v_card.owner_id;
  update public.crm_pipeline_cards
     set owner_id = p_owner_id, version = version + 1, updated_at = now()
   where id = p_card_id
  returning * into v_card;

  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'crm.card.assigned', 'crm_pipeline_card', v_card.id::text,
          jsonb_build_object('client_id', v_card.client_id, 'from_owner_id', v_from, 'to_owner_id', p_owner_id, 'version', v_card.version));
  return v_card;
end;
$function$;

create or replace function public.crm_board_v1(p_pipeline_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_chats boolean;
  v_cards jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.has_org_capability(v_org, 'can_view_customers') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists (select 1 from public.crm_pipelines where id = p_pipeline_id and organization_id = v_org) then
    raise exception 'PIPELINE_NOT_FOUND' using errcode='P0002';
  end if;
  v_chats := private.has_org_capability(v_org, 'can_view_chats');

  select coalesce(jsonb_agg(item order by (item->>'stage_entered_at') desc), '[]'::jsonb) into v_cards
    from (
      select jsonb_build_object(
          'id', c.id, 'pipeline_id', c.pipeline_id, 'stage_id', c.stage_id, 'client_id', c.client_id,
          'version', c.version, 'stage_entered_at', c.stage_entered_at, 'owner_id', c.owner_id,
          'next_callback_at', case when la.outcome = 'callback' then la.callback_at end,
          'last_call_outcome', la.outcome,
          'last_interaction_at', greatest(la.created_at, case when v_chats then conv.last_activity_at end),
          'conversation_id', case when v_chats then conv.id end,
          'tags', case when v_chats then coalesce(tg.tags, '[]'::jsonb) else '[]'::jsonb end,
          'open_tasks', case when v_chats then coalesce(tk.open_tasks, 0) else 0 end,
          'late_tasks', case when v_chats then coalesce(tk.late_tasks, 0) else 0 end,
          'next_task_due_at', case when v_chats then tk.next_due_at end
        ) || private.client_card_json(cl.data) as item
        from public.crm_pipeline_cards c
        join public.clients cl on cl.id = c.client_id
        left join lateral (
          select a.outcome, a.callback_at, a.created_at from public.crm_call_attempts a
           where a.organization_id = v_org and a.client_id = c.client_id order by a.created_at desc limit 1
        ) la on true
        left join lateral (
          select x.id, x.last_activity_at from public.crm_conversations x
           where x.organization_id = v_org and x.customer_id = c.client_id order by x.last_activity_at desc limit 1
        ) conv on true
        left join lateral (
          select jsonb_agg(distinct coalesce(t.name, ct.tag)) as tags
            from public.crm_conversations x
            join public.crm_conversation_tags ct on ct.conversation_id = x.id
            left join public.crm_tags t on t.id = ct.tag_id
           where x.organization_id = v_org and x.customer_id = c.client_id
        ) tg on true
        left join lateral (
          select count(*) as open_tasks, count(*) filter (where t.due_at < now()) as late_tasks, min(t.due_at) as next_due_at
            from public.crm_tasks t
           where t.organization_id = v_org and t.client_id = c.client_id and t.status in ('open', 'in_progress')
        ) tk on true
       where c.pipeline_id = p_pipeline_id and c.organization_id = v_org
       order by c.stage_entered_at desc
       limit 1000
    ) cards;

  return jsonb_build_object('cards', v_cards, 'members', private.org_members_json(v_org), 'can_view_chats', v_chats);
end;
$function$;

-- Who to call now. One row per customer, by the latest attempt:
--   callback_due / callback_scheduled: last outcome asked for a callback
--   retry:        last outcome was no answer, busy or voicemail and the card is still open
--   never_called: card in an open stage with no attempt yet
-- Converted, not interested and wrong number leave the queue until someone calls again.
create or replace function public.crm_call_queue_v1(p_only_mine boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_chats boolean;
  v_items jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.has_org_capability(v_org, 'can_view_customers') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_chats := private.has_org_capability(v_org, 'can_view_chats');

  with cards as (
    select distinct on (c.client_id) c.id, c.client_id, c.pipeline_id, c.stage_id, c.version, c.owner_id, c.stage_entered_at, s.name as stage_name, s.kind
      from public.crm_pipeline_cards c
      join public.crm_stages s on s.id = c.stage_id
      join public.crm_pipelines p on p.id = c.pipeline_id
     where c.organization_id = v_org
     order by c.client_id, p.is_default desc, c.updated_at desc
  ), attempts as (
    select distinct on (a.client_id) a.client_id, a.outcome, a.callback_at, a.created_at, a.created_by
      from public.crm_call_attempts a
     where a.organization_id = v_org
     order by a.client_id, a.created_at desc
  ), queue as (
    select coalesce(cd.client_id, at.client_id) as client_id, cd.id as card_id, cd.pipeline_id, cd.stage_id, cd.version, cd.owner_id,
           cd.stage_entered_at, cd.stage_name, cd.kind, at.outcome, at.callback_at, at.created_at as last_called_at, at.created_by,
           case
             when at.outcome = 'callback' and at.callback_at is not null then case when at.callback_at <= now() then 'callback_due' else 'callback_scheduled' end
             when at.client_id is null and cd.kind = 'open' then 'never_called'
             when at.outcome in ('no_answer', 'busy', 'voicemail') and cd.kind = 'open' then 'retry'
           end as reason
      from cards cd
      full join attempts at on at.client_id = cd.client_id
  )
  select coalesce(jsonb_agg(item order by priority, sort_at), '[]'::jsonb) into v_items
    from (
      select jsonb_build_object(
          'client_id', q.client_id, 'reason', q.reason, 'card_id', q.card_id, 'pipeline_id', q.pipeline_id, 'stage_id', q.stage_id,
          'card_version', q.version, 'stage_name', q.stage_name, 'stage_kind', q.kind, 'owner_id', q.owner_id,
          'last_call_outcome', q.outcome, 'last_called_at', q.last_called_at, 'callback_at', q.callback_at,
          'stage_entered_at', q.stage_entered_at,
          'conversation_id', case when v_chats then (select x.id from public.crm_conversations x where x.organization_id = v_org and x.customer_id = q.client_id order by x.last_activity_at desc limit 1) end
        ) || private.client_card_json(cl.data) as item,
        case q.reason when 'callback_due' then 1 when 'retry' then 2 when 'never_called' then 3 else 4 end as priority,
        coalesce(q.callback_at, q.last_called_at, q.stage_entered_at) as sort_at
        from queue q
        join public.clients cl on cl.id = q.client_id and cl.organization_id = v_org
       where q.reason is not null
         and (not coalesce(p_only_mine, false) or coalesce(q.owner_id, q.created_by) = auth.uid())
       order by priority, sort_at
       limit 300
    ) r;

  return jsonb_build_object('items', v_items, 'members', private.org_members_json(v_org));
end;
$function$;

-- Everything the operator needs during a call, for one customer.
create or replace function public.crm_client_call_context_v1(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_chats boolean;
  v_values boolean;
  v_client public.clients;
  v_emails text[];
  v_conversations jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_conversation_tx uuid[];
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.has_org_capability(v_org, 'can_view_customers') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into v_client from public.clients where id = p_client_id and organization_id = v_org;
  if not found then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  v_chats := private.has_org_capability(v_org, 'can_view_chats');
  v_values := private.has_org_capability(v_org, 'can_view_values');

  select array_agg(distinct e) into v_emails from (
    select value as e from public.customer_identities where organization_id = v_org and client_id = p_client_id and kind = 'email'
    union select lower(private.client_field(v_client.data, array['email', 'buyer_email', 'customer_email']))
  ) x where e is not null;

  select array_agg(transaction_id) into v_conversation_tx
    from public.crm_conversations where organization_id = v_org and customer_id = p_client_id and transaction_id is not null;

  if v_chats then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'channel', x.primary_channel, 'funnel_id', x.funnel_id,
             'assigned_to', x.assigned_to, 'last_activity_at', x.last_activity_at) order by x.last_activity_at desc), '[]'::jsonb)
      into v_conversations
      from (select * from public.crm_conversations where organization_id = v_org and customer_id = p_client_id order by last_activity_at desc limit 10) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'due_at', t.due_at,
             'assigned_to', t.assigned_to) order by t.due_at nulls last), '[]'::jsonb)
      into v_tasks
      from (select * from public.crm_tasks where organization_id = v_org and client_id = p_client_id and status in ('open', 'in_progress') order by due_at nulls last limit 20) t;
  end if;

  return jsonb_build_object(
    'client', jsonb_build_object('id', v_client.id, 'created_at', v_client.created_at,
                                 'origin_funnel_id', coalesce(v_client.data->>'last_funnel_id', v_client.data->>'funnel_id'))
              || private.client_card_json(v_client.data),
    'cards', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'pipeline_id', c.pipeline_id, 'pipeline_name', p.name, 'stage_id', c.stage_id,
                'stage_name', s.name, 'stage_kind', s.kind, 'version', c.version, 'owner_id', c.owner_id,
                'stages', (select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'kind', st.kind) order by st.position) from public.crm_stages st where st.pipeline_id = c.pipeline_id))
                order by p.is_default desc, c.updated_at desc), '[]'::jsonb)
                from public.crm_pipeline_cards c join public.crm_pipelines p on p.id = c.pipeline_id join public.crm_stages s on s.id = c.stage_id
               where c.organization_id = v_org and c.client_id = p_client_id),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'outcome', a.outcome, 'notes', a.notes, 'duration_seconds', a.duration_seconds,
                'callback_at', a.callback_at, 'to_stage_id', a.to_stage_id, 'created_by', a.created_by, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
                from (select * from public.crm_call_attempts where organization_id = v_org and client_id = p_client_id order by created_at desc limit 20) a),
    'conversations', v_conversations,
    'tasks', v_tasks,
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'created_at', t.created_at, 'completed_at', t.completed_at,
                'payment_method', t.metadata->>'payment_method', 'funnel_id', t.funnel_id, 'product_id', t.product_id,
                'amount', case when v_values then t.amount end, 'currency', t.currency) order by t.created_at desc), '[]'::jsonb)
                from (select * from public.gateway_transactions g
                       where g.organization_id = v_org
                         and (g.id = any(coalesce(v_conversation_tx, '{}')) or lower(g.customer->>'email') = any(coalesce(v_emails, '{}')))
                       order by g.created_at desc limit 10) t),
    'members', private.org_members_json(v_org),
    'can_view_chats', v_chats,
    'can_view_values', v_values
  );
end;
$function$;

drop function if exists public.crm_task_save(uuid, text, text, text, timestamptz, uuid, uuid);
create or replace function public.crm_task_save(
  p_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_assigned_to uuid default null,
  p_conversation_id uuid default null,
  p_client_id text default null
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
  v_client text := nullif(btrim(coalesce(p_client_id, '')), '');
  v_conversation_client text;
  v_task public.crm_tasks;
begin
  select * into c from private.crm_config_context('can_reply_chats');
  if v_title = '' or length(v_title) > 200 then raise exception 'TASK_TITLE_INVALID' using errcode='22023'; end if;
  if length(coalesce(p_description, '')) > 5000 then raise exception 'TASK_DESCRIPTION_TOO_LONG' using errcode='22001'; end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'INVALID_PRIORITY' using errcode='22023'; end if;
  if p_assigned_to is not null and not exists (select 1 from public.organization_members where organization_id = c.organization_id and user_id = p_assigned_to) then
    raise exception 'ASSIGNEE_NOT_MEMBER' using errcode='22023';
  end if;
  if p_conversation_id is not null then
    select customer_id into v_conversation_client from public.crm_conversations where id = p_conversation_id and organization_id = c.organization_id;
    if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
    v_client := coalesce(v_client, v_conversation_client);
  end if;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client and organization_id = c.organization_id) then
    raise exception 'CLIENT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_id is null then
    insert into public.crm_tasks(user_id, organization_id, conversation_id, client_id, assigned_to, title, description, status, priority, due_at, created_by)
    values (c.owner_id, c.organization_id, p_conversation_id, v_client, p_assigned_to, v_title, nullif(btrim(coalesce(p_description, '')), ''), 'open', v_priority, p_due_at, auth.uid())
    returning * into v_task;
  else
    update public.crm_tasks
       set title = v_title, description = nullif(btrim(coalesce(p_description, '')), ''), priority = v_priority,
           due_at = p_due_at, assigned_to = p_assigned_to, conversation_id = p_conversation_id, client_id = v_client, updated_at = now()
     where id = p_id and organization_id = c.organization_id
    returning * into v_task;
    if not found then raise exception 'TASK_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.task.saved', 'crm_task', v_task.id::text,
          jsonb_build_object('title', v_task.title, 'priority', v_task.priority, 'assigned_to', v_task.assigned_to, 'due_at', v_task.due_at, 'client_id', v_task.client_id));
  return v_task;
end;
$function$;

revoke all on function public.crm_card_assign(uuid, uuid, integer) from public, anon;
revoke all on function public.crm_board_v1(uuid) from public, anon;
revoke all on function public.crm_call_queue_v1(boolean) from public, anon;
revoke all on function public.crm_client_call_context_v1(text) from public, anon;
revoke all on function public.crm_task_save(uuid, text, text, text, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function public.crm_card_assign(uuid, uuid, integer) to authenticated;
grant execute on function public.crm_board_v1(uuid) to authenticated;
grant execute on function public.crm_call_queue_v1(boolean) to authenticated;
grant execute on function public.crm_client_call_context_v1(text) to authenticated;
grant execute on function public.crm_task_save(uuid, text, text, text, timestamptz, uuid, uuid, text) to authenticated;
