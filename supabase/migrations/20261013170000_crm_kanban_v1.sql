-- CRM Kanban v1: pipelines, stages and one card per customer (clients) per pipeline.
-- Reads follow RLS; every write goes through the RPCs below and is audited.
--   configure pipelines/stages: can_manage_funnels
--   view cards:                 can_view_customers
--   add/move cards:             can_view_customers + can_reply_chats

create table public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index crm_pipelines_one_default_idx on public.crm_pipelines(organization_id) where is_default;

create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null,
  kind text not null default 'open' check (kind in ('open','won','lost')),
  created_at timestamptz not null default now(),
  unique (id, pipeline_id),
  foreign key (pipeline_id, organization_id) references public.crm_pipelines(id, organization_id) on delete cascade
);
create index crm_stages_pipeline_idx on public.crm_stages(pipeline_id, position);

create table public.crm_pipeline_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_id uuid not null,
  stage_id uuid not null,
  client_id text not null references public.clients(id) on delete cascade,
  version integer not null default 1,
  stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, client_id),
  foreign key (pipeline_id, organization_id) references public.crm_pipelines(id, organization_id) on delete cascade,
  -- the stage must belong to the card's pipeline; a stage with cards cannot be deleted
  foreign key (stage_id, pipeline_id) references public.crm_stages(id, pipeline_id) on delete restrict
);
create index crm_pipeline_cards_stage_idx on public.crm_pipeline_cards(stage_id, stage_entered_at desc);
create index crm_pipeline_cards_client_idx on public.crm_pipeline_cards(client_id);

alter table public.crm_pipelines enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_pipeline_cards enable row level security;
create policy crm_pipelines_member_select on public.crm_pipelines for select to authenticated using (private.is_org_member(organization_id));
create policy crm_stages_member_select on public.crm_stages for select to authenticated using (private.is_org_member(organization_id));
create policy crm_pipeline_cards_customers_select on public.crm_pipeline_cards for select to authenticated using (private.has_org_capability(organization_id, 'can_view_customers'));
revoke all on public.crm_pipelines, public.crm_stages, public.crm_pipeline_cards from anon, authenticated;
grant select on public.crm_pipelines, public.crm_stages, public.crm_pipeline_cards to authenticated;
alter publication supabase_realtime add table public.crm_pipeline_cards;

-- p_stages: [{"id"?: uuid, "name": text, "kind"?: "open"|"won"|"lost"}] in display order.
-- Stages left out are deleted, which fails with STAGE_NOT_EMPTY while they still hold cards.
create or replace function public.crm_pipeline_save(
  p_pipeline_id uuid,
  p_name text,
  p_stages jsonb,
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_pipeline public.crm_pipelines;
  v_stage jsonb;
  v_stage_id uuid;
  v_kept uuid[] := '{}';
  v_position integer := 0;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.has_org_capability(v_org, 'can_manage_funnels') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'PIPELINE_NAME_REQUIRED' using errcode='22023'; end if;
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) not between 1 and 20 then
    raise exception 'STAGES_REQUIRED' using errcode='22023';
  end if;

  if coalesce(p_is_default, false) then
    update public.crm_pipelines set is_default = false, updated_at = now()
     where organization_id = v_org and is_default and id is distinct from p_pipeline_id;
  end if;

  if p_pipeline_id is null then
    insert into public.crm_pipelines(organization_id, name, is_default, created_by)
    values (v_org, trim(p_name), coalesce(p_is_default, false), auth.uid())
    returning * into v_pipeline;
  else
    update public.crm_pipelines
       set name = trim(p_name), is_default = coalesce(p_is_default, false), updated_at = now()
     where id = p_pipeline_id and organization_id = v_org
    returning * into v_pipeline;
    if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode='P0002'; end if;
  end if;

  for v_stage in select value from jsonb_array_elements(p_stages) loop
    v_position := v_position + 1;
    if nullif(trim(v_stage->>'name'), '') is null then raise exception 'STAGE_NAME_REQUIRED' using errcode='22023'; end if;
    if coalesce(v_stage->>'kind', 'open') not in ('open','won','lost') then raise exception 'INVALID_STAGE_KIND' using errcode='22023'; end if;
    v_stage_id := nullif(v_stage->>'id', '')::uuid;
    if v_stage_id is not null then
      update public.crm_stages
         set name = trim(v_stage->>'name'), kind = coalesce(v_stage->>'kind', 'open'), position = v_position
       where id = v_stage_id and pipeline_id = v_pipeline.id;
      if not found then raise exception 'STAGE_NOT_FOUND' using errcode='P0002'; end if;
    else
      insert into public.crm_stages(organization_id, pipeline_id, name, position, kind)
      values (v_org, v_pipeline.id, trim(v_stage->>'name'), v_position, coalesce(v_stage->>'kind', 'open'))
      returning id into v_stage_id;
    end if;
    v_kept := v_kept || v_stage_id;
  end loop;

  begin
    delete from public.crm_stages where pipeline_id = v_pipeline.id and id <> all(v_kept);
  exception when foreign_key_violation then
    raise exception 'STAGE_NOT_EMPTY' using errcode='23503';
  end;

  if not exists (select 1 from public.crm_stages where pipeline_id = v_pipeline.id and kind = 'open') then
    raise exception 'OPEN_STAGE_REQUIRED' using errcode='22023';
  end if;

  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'crm.pipeline.saved', 'crm_pipeline', v_pipeline.id::text,
          jsonb_build_object('name', v_pipeline.name, 'is_default', v_pipeline.is_default, 'stage_count', v_position));

  return jsonb_build_object(
    'pipeline', to_jsonb(v_pipeline),
    'stages', (select jsonb_agg(to_jsonb(s) order by s.position) from public.crm_stages s where s.pipeline_id = v_pipeline.id)
  );
end;
$function$;

-- Idempotent: a customer already in the pipeline returns the existing card untouched.
create or replace function public.crm_card_add(p_pipeline_id uuid, p_client_id text, p_stage_id uuid default null)
returns public.crm_pipeline_cards
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_card public.crm_pipeline_cards;
  v_stage_id uuid := p_stage_id;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not (private.has_org_capability(v_org, 'can_view_customers') and private.has_org_capability(v_org, 'can_reply_chats')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if not exists (select 1 from public.crm_pipelines where id = p_pipeline_id and organization_id = v_org) then
    raise exception 'PIPELINE_NOT_FOUND' using errcode='P0002';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and organization_id = v_org) then
    raise exception 'CLIENT_NOT_FOUND' using errcode='P0002';
  end if;
  if v_stage_id is null then
    select id into v_stage_id from public.crm_stages where pipeline_id = p_pipeline_id and kind = 'open' order by position limit 1;
  elsif not exists (select 1 from public.crm_stages where id = v_stage_id and pipeline_id = p_pipeline_id) then
    raise exception 'STAGE_NOT_IN_PIPELINE' using errcode='22023';
  end if;

  insert into public.crm_pipeline_cards(organization_id, pipeline_id, stage_id, client_id)
  values (v_org, p_pipeline_id, v_stage_id, p_client_id)
  on conflict (pipeline_id, client_id) do nothing
  returning * into v_card;

  if not found then
    select * into v_card from public.crm_pipeline_cards where pipeline_id = p_pipeline_id and client_id = p_client_id;
    return v_card;
  end if;

  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'crm.card.added', 'crm_pipeline_card', v_card.id::text,
          jsonb_build_object('pipeline_id', p_pipeline_id, 'client_id', p_client_id, 'stage_id', v_stage_id));
  return v_card;
end;
$function$;

-- Optimistic concurrency: p_expected_version must match, so two operators dragging the
-- same card cannot silently overwrite each other (CARD_VERSION_CONFLICT -> reload).
create or replace function public.crm_card_move(p_card_id uuid, p_stage_id uuid, p_expected_version integer)
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
  if not exists (select 1 from public.crm_stages where id = p_stage_id and pipeline_id = v_card.pipeline_id) then
    raise exception 'STAGE_NOT_IN_PIPELINE' using errcode='22023';
  end if;
  if v_card.stage_id = p_stage_id then return v_card; end if;

  v_from := v_card.stage_id;
  update public.crm_pipeline_cards
     set stage_id = p_stage_id, version = version + 1, stage_entered_at = now(), updated_at = now()
   where id = p_card_id
  returning * into v_card;

  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'crm.card.moved', 'crm_pipeline_card', v_card.id::text,
          jsonb_build_object('pipeline_id', v_card.pipeline_id, 'client_id', v_card.client_id, 'from_stage_id', v_from, 'to_stage_id', p_stage_id, 'version', v_card.version));
  return v_card;
end;
$function$;

revoke all on function public.crm_pipeline_save(uuid, text, jsonb, boolean) from public, anon;
revoke all on function public.crm_card_add(uuid, text, uuid) from public, anon;
revoke all on function public.crm_card_move(uuid, uuid, integer) from public, anon;
grant execute on function public.crm_pipeline_save(uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.crm_card_add(uuid, text, uuid) to authenticated;
grant execute on function public.crm_card_move(uuid, uuid, integer) to authenticated;

-- New customers (funnel events, gateway, chat) enter the organization's default pipeline.
create or replace function private.crm_card_enter_default_pipeline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.crm_pipeline_cards(organization_id, pipeline_id, stage_id, client_id)
  select new.organization_id, p.id, s.id, new.id
    from public.crm_pipelines p
    join lateral (
      select id from public.crm_stages where pipeline_id = p.id and kind = 'open' order by position limit 1
    ) s on true
   where p.organization_id = new.organization_id and p.is_default
  on conflict (pipeline_id, client_id) do nothing;
  return new;
end;
$function$;
revoke all on function private.crm_card_enter_default_pipeline() from public, anon, authenticated;

create trigger clients_enter_default_pipeline
after insert on public.clients
for each row execute function private.crm_card_enter_default_pipeline();
