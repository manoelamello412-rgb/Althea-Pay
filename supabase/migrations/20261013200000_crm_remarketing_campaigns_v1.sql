-- Remarketing: message templates, organization-scoped segments and campaigns on top of the
-- existing channel outbox. Campaign sends are plain outbox rows (metadata.campaign_id), so
-- delivery, retries, opt-out blocking and delivery reports reuse the dispatcher path.
--   templates, segments, campaigns: read can_view_chats, write can_manage_automations
--   pg_cron enqueues due campaigns every minute (public.crm_campaign_enqueue_due)
-- Placeholders follow WhatsApp ({{1}}, {{2}}, ...); variables[n] names the value for {{n}}.

create table if not exists public.crm_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  channel text not null check (channel in ('whatsapp', 'email', 'sms')),
  trigger_event text check (trigger_event in ('checkout_abandoned')),
  subject text check (length(subject) <= 200),
  body text not null check (length(body) between 1 and 4000),
  variables text[] not null default '{}',
  whatsapp_template_name text check (whatsapp_template_name ~ '^[a-z0-9_]{1,512}$'),
  language text not null default 'pt_BR' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  check (channel <> 'whatsapp' or whatsapp_template_name is not null),
  check (channel <> 'email' or subject is not null),
  check (variables <@ array['nome', 'primeiro_nome', 'email', 'telefone', 'link', 'valor', 'produto'])
);
create unique index if not exists crm_message_templates_trigger_uidx
  on public.crm_message_templates (organization_id, channel, trigger_event) where trigger_event is not null and active;

create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  channel_account_id uuid not null references public.crm_channel_accounts(id),
  template_id uuid not null references public.crm_message_templates(id),
  segment_id uuid not null references public.crm_segments(id),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'enqueued', 'cancelled')),
  scheduled_at timestamptz,
  enqueued_at timestamptz,
  recipient_count integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_campaigns_due_idx on public.crm_campaigns (scheduled_at) where status = 'scheduled';
create index if not exists crm_channel_message_outbox_campaign_idx
  on public.crm_channel_message_outbox ((metadata->>'campaign_id')) where metadata ? 'campaign_id';

alter table public.crm_message_templates enable row level security;
alter table public.crm_campaigns enable row level security;
drop policy if exists crm_segments_owner on public.crm_segments;
create policy crm_message_templates_org_select on public.crm_message_templates for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
create policy crm_campaigns_org_select on public.crm_campaigns for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
create policy crm_segments_org_select on public.crm_segments for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));
revoke all on public.crm_message_templates, public.crm_campaigns from anon, authenticated;
revoke insert, update, delete on public.crm_segments from anon, authenticated;
grant select on public.crm_message_templates, public.crm_campaigns, public.crm_segments to authenticated;

-- {{n}} -> context[variables[n]]; missing values render empty.
create or replace function private.crm_render_template(p_body text, p_variables text[], p_context jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_body text := p_body;
begin
  for i in 1..coalesce(array_length(p_variables, 1), 0) loop
    v_body := replace(v_body, '{{' || i || '}}', coalesce(p_context->>p_variables[i], ''));
  end loop;
  return v_body;
end;
$function$;

create or replace function private.crm_template_placeholders(p_variables text[], p_context jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(coalesce(p_context->>v, '') order by n), '[]'::jsonb)
    from unnest(p_variables) with ordinality as t(v, n)
$function$;

-- Contacts reachable on a channel that match the segment, one per normalized address, opted-out excluded.
create or replace function private.crm_campaign_audience(p_organization_id uuid, p_segment_id uuid, p_channel text)
returns table(conversation_id uuid, address text, display_name text, email text, phone text)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  with s as (
    select coalesce(definition, '{}'::jsonb) as d
      from public.crm_segments
     where id = p_segment_id and organization_id = p_organization_id and active
  )
  select distinct on (a.addr) cv.id, a.addr, i.display_name, i.email, coalesce(i.phone_e164, i.external_user_id)
    from s
    join public.crm_conversations cv on cv.organization_id = p_organization_id
    join public.crm_channel_identities i on i.conversation_id = cv.id and i.channel = p_channel
    cross join lateral (
      select private.crm_consent_address(p_channel, case when p_channel = 'email' then i.email else coalesce(i.phone_e164, i.external_user_id) end) as addr
    ) a
   where a.addr is not null
     and (jsonb_array_length(coalesce(s.d->'tag_ids', '[]')) = 0 or exists (
           select 1 from public.crm_conversation_tags ct
            where ct.conversation_id = cv.id and ct.tag_id::text in (select jsonb_array_elements_text(s.d->'tag_ids'))))
     and (jsonb_array_length(coalesce(s.d->'checkout_status', '[]')) = 0
          or cv.checkout_status::text in (select jsonb_array_elements_text(s.d->'checkout_status')))
     and (s.d->'last_activity_days' is null
          or cv.last_activity_at >= now() - make_interval(days => (s.d->>'last_activity_days')::int))
     and not exists (
           select 1 from public.crm_channel_consents k
            where k.organization_id = p_organization_id and k.channel = p_channel and k.address = a.addr and k.status = 'opted_out')
   order by a.addr, i.updated_at desc
$function$;
revoke all on function private.crm_campaign_audience(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.crm_template_save(
  p_id uuid,
  p_name text,
  p_channel text,
  p_body text,
  p_variables text[] default '{}',
  p_subject text default null,
  p_whatsapp_template_name text default null,
  p_language text default 'pt_BR',
  p_trigger_event text default null,
  p_active boolean default true
)
returns public.crm_message_templates
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_message_templates;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  begin
    if p_id is null then
      insert into public.crm_message_templates(organization_id, user_id, name, channel, body, variables, subject, whatsapp_template_name, language, trigger_event, active)
      values (c.organization_id, c.owner_id, btrim(p_name), p_channel, btrim(p_body), coalesce(p_variables, '{}'), nullif(btrim(p_subject), ''),
              nullif(btrim(p_whatsapp_template_name), ''), coalesce(nullif(btrim(p_language), ''), 'pt_BR'), nullif(p_trigger_event, ''), coalesce(p_active, true))
      returning * into v;
    else
      update public.crm_message_templates
         set name = btrim(p_name), channel = p_channel, body = btrim(p_body), variables = coalesce(p_variables, '{}'),
             subject = nullif(btrim(p_subject), ''), whatsapp_template_name = nullif(btrim(p_whatsapp_template_name), ''),
             language = coalesce(nullif(btrim(p_language), ''), 'pt_BR'), trigger_event = nullif(p_trigger_event, ''),
             active = coalesce(p_active, true), updated_at = now()
       where id = p_id and organization_id = c.organization_id
      returning * into v;
      if not found then raise exception 'TEMPLATE_NOT_FOUND' using errcode='P0002'; end if;
    end if;
  exception
    when unique_violation then raise exception 'NAME_TAKEN' using errcode='23505';
    when check_violation then raise exception 'TEMPLATE_INVALID' using errcode='23514';
  end;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.template.saved', 'crm_message_template', v.id::text, jsonb_build_object('name', v.name, 'channel', v.channel, 'active', v.active));
  return v;
end;
$function$;

create or replace function public.crm_segment_save(p_id uuid, p_name text, p_definition jsonb, p_description text default null, p_active boolean default true)
returns public.crm_segments
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_segments;
  v_def jsonb := coalesce(p_definition, '{}'::jsonb);
  v_days int;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if btrim(coalesce(p_name, '')) = '' or length(p_name) > 80 then raise exception 'SEGMENT_NAME_INVALID' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(v_def) k where k not in ('tag_ids', 'checkout_status', 'last_activity_days')) then
    raise exception 'SEGMENT_DEFINITION_INVALID' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(v_def->'tag_ids', '[]')) <> 'array' or exists (
       select 1 from jsonb_array_elements_text(coalesce(v_def->'tag_ids', '[]')) t
        where not exists (select 1 from public.crm_tags g where g.id::text = t and g.organization_id = c.organization_id)) then
    raise exception 'SEGMENT_DEFINITION_INVALID' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(v_def->'checkout_status', '[]')) <> 'array' or exists (
       select 1 from jsonb_array_elements_text(coalesce(v_def->'checkout_status', '[]')) s
        where s not in (select unnest(enum_range(null::public.lead_checkout_status))::text)) then
    raise exception 'SEGMENT_DEFINITION_INVALID' using errcode='22023';
  end if;
  if v_def ? 'last_activity_days' then
    v_days := (v_def->>'last_activity_days')::int;
    if v_days not between 1 and 3650 then raise exception 'SEGMENT_DEFINITION_INVALID' using errcode='22023'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.crm_segments(user_id, organization_id, name, description, definition, active)
      values (c.owner_id, c.organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_def, coalesce(p_active, true))
      returning * into v;
    else
      update public.crm_segments
         set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), definition = v_def, active = coalesce(p_active, true), updated_at = now()
       where id = p_id and organization_id = c.organization_id
      returning * into v;
      if not found then raise exception 'SEGMENT_NOT_FOUND' using errcode='P0002'; end if;
    end if;
  exception when unique_violation then
    raise exception 'NAME_TAKEN' using errcode='23505';
  end;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.segment.saved', 'crm_segment', v.id::text, jsonb_build_object('name', v.name, 'definition', v.definition));
  return v;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'SEGMENT_DEFINITION_INVALID' using errcode='22023';
end;
$function$;

create or replace function public.crm_segment_audience_count(p_segment_id uuid, p_channel text)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_view_chats') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return (select count(*) from private.crm_campaign_audience(v_org, p_segment_id, p_channel));
end;
$function$;

create or replace function public.crm_campaign_save(p_id uuid, p_name text, p_channel_account_id uuid, p_template_id uuid, p_segment_id uuid)
returns public.crm_campaigns
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_campaigns;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if btrim(coalesce(p_name, '')) = '' then raise exception 'CAMPAIGN_NAME_INVALID' using errcode='22023'; end if;
  if not exists (
       select 1 from public.crm_channel_accounts a
         join public.crm_message_templates t on t.id = p_template_id and t.organization_id = c.organization_id and t.channel = a.channel
         join public.crm_segments s on s.id = p_segment_id and s.organization_id = c.organization_id
        where a.id = p_channel_account_id and a.organization_id = c.organization_id) then
    raise exception 'CAMPAIGN_REFERENCES_INVALID' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.crm_campaigns(organization_id, user_id, name, channel_account_id, template_id, segment_id)
    values (c.organization_id, c.owner_id, btrim(p_name), p_channel_account_id, p_template_id, p_segment_id)
    returning * into v;
  else
    update public.crm_campaigns
       set name = btrim(p_name), channel_account_id = p_channel_account_id, template_id = p_template_id, segment_id = p_segment_id, updated_at = now()
     where id = p_id and organization_id = c.organization_id and status = 'draft'
    returning * into v;
    if not found then raise exception 'CAMPAIGN_NOT_EDITABLE' using errcode='P0002'; end if;
  end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.campaign.saved', 'crm_campaign', v.id::text, jsonb_build_object('name', v.name, 'template_id', v.template_id, 'segment_id', v.segment_id));
  return v;
end;
$function$;

create or replace function public.crm_campaign_set_status(p_id uuid, p_status text, p_scheduled_at timestamptz default null)
returns public.crm_campaigns
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_campaigns;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if p_status = 'scheduled' then
    update public.crm_campaigns k
       set status = 'scheduled', scheduled_at = greatest(coalesce(p_scheduled_at, now()), now()), updated_at = now()
     where k.id = p_id and k.organization_id = c.organization_id and k.status = 'draft'
       and exists (select 1 from public.crm_channel_accounts a where a.id = k.channel_account_id and a.status = 'active')
       and exists (select 1 from public.crm_message_templates t where t.id = k.template_id and t.active)
    returning * into v;
  elsif p_status = 'draft' or p_status = 'cancelled' then
    update public.crm_campaigns
       set status = p_status, scheduled_at = null, updated_at = now()
     where id = p_id and organization_id = c.organization_id and status in ('draft', 'scheduled')
    returning * into v;
  else
    raise exception 'INVALID_STATUS' using errcode='22023';
  end if;
  if v.id is null then raise exception 'CAMPAIGN_STATUS_CONFLICT' using errcode='P0002'; end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.campaign.' || p_status, 'crm_campaign', v.id::text, jsonb_build_object('scheduled_at', v.scheduled_at));
  return v;
end;
$function$;

create or replace function public.crm_campaign_metrics(p_campaign_ids uuid[])
returns table(campaign_id uuid, queued bigint, sent bigint, delivered bigint, read bigint, failed bigint, opted_out bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_view_chats') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return query
  select k.id,
         count(o.id) filter (where o.status in ('queued', 'processing')),
         count(o.id) filter (where o.status = 'sent'),
         count(o.id) filter (where o.metadata->>'delivery_status' in ('delivered', 'read')),
         count(o.id) filter (where o.metadata->>'delivery_status' = 'read'),
         count(o.id) filter (where o.status in ('failed', 'dead_letter') and o.last_error is distinct from 'recipient_opted_out'),
         count(o.id) filter (where o.last_error = 'recipient_opted_out')
    from public.crm_campaigns k
    left join public.crm_channel_message_outbox o on o.metadata->>'campaign_id' = k.id::text
   where k.id = any(p_campaign_ids) and k.organization_id = v_org
   group by k.id;
end;
$function$;

revoke all on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean) from public, anon;
revoke all on function public.crm_segment_save(uuid, text, jsonb, text, boolean) from public, anon;
revoke all on function public.crm_segment_audience_count(uuid, text) from public, anon;
revoke all on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.crm_campaign_set_status(uuid, text, timestamptz) from public, anon;
revoke all on function public.crm_campaign_metrics(uuid[]) from public, anon;
grant execute on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean) to authenticated;
grant execute on function public.crm_segment_save(uuid, text, jsonb, text, boolean) to authenticated;
grant execute on function public.crm_segment_audience_count(uuid, text) to authenticated;
grant execute on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_campaign_set_status(uuid, text, timestamptz) to authenticated;
grant execute on function public.crm_campaign_metrics(uuid[]) to authenticated;

-- Worker: turn each due campaign into outbox rows (idempotent per campaign + address).
create or replace function public.crm_campaign_enqueue_due(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  k record;
  r record;
  v_ctx jsonb;
  v_count integer;
  v_done integer := 0;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;
  for k in
    select cp.*, t.channel, t.body, t.subject, t.variables, t.whatsapp_template_name, t.language
      from public.crm_campaigns cp
      join public.crm_message_templates t on t.id = cp.template_id
     where cp.status = 'scheduled' and cp.scheduled_at <= now()
     order by cp.scheduled_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
       for update of cp skip locked
  loop
    v_count := 0;
    for r in select * from private.crm_campaign_audience(k.organization_id, k.segment_id, k.channel) loop
      v_ctx := jsonb_build_object('nome', r.display_name, 'primeiro_nome', split_part(coalesce(r.display_name, ''), ' ', 1), 'email', r.email, 'telefone', r.phone);
      insert into public.crm_channel_message_outbox(user_id, organization_id, conversation_id, channel_account_id, channel, direction, body, status, next_attempt_at, idempotency_key, metadata)
      values (k.user_id, k.organization_id, r.conversation_id, k.channel_account_id, k.channel, 'outbound',
              private.crm_render_template(k.body, k.variables, v_ctx), 'queued', now(),
              'campaign:' || k.id || ':' || r.address,
              jsonb_build_object('source', 'campaign', 'campaign_id', k.id, 'email_subject', private.crm_render_template(k.subject, k.variables, v_ctx))
              || case when k.channel = 'whatsapp' then jsonb_build_object('whatsapp_template', jsonb_build_object(
                   'name', k.whatsapp_template_name, 'language', k.language, 'placeholders', private.crm_template_placeholders(k.variables, v_ctx)))
                 else '{}'::jsonb end)
      on conflict (user_id, idempotency_key) do nothing;
      v_count := v_count + 1;
    end loop;
    update public.crm_campaigns set status = 'enqueued', enqueued_at = now(), recipient_count = v_count, updated_at = now() where id = k.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$function$;
revoke all on function public.crm_campaign_enqueue_due(integer) from public, anon, authenticated;
grant execute on function public.crm_campaign_enqueue_due(integer) to service_role;

-- Email unsubscribe link (crm-channel-unsubscribe) records the opt-out through here.
create or replace function public.crm_channel_record_consent(p_organization_id uuid, p_channel text, p_address text, p_status text, p_source text)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  insert into public.crm_channel_consents (organization_id, channel, address, status, source)
  values (p_organization_id, p_channel, private.crm_consent_address(p_channel, p_address), p_status, p_source)
  on conflict (organization_id, channel, address) do update
    set status = excluded.status, source = excluded.source, source_message_id = null, updated_at = now()
$function$;
revoke all on function public.crm_channel_record_consent(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.crm_channel_record_consent(uuid, text, text, text, text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'althea-crm-campaign-enqueue') then
    perform cron.unschedule('althea-crm-campaign-enqueue');
  end if;
end
$$;
select cron.schedule('althea-crm-campaign-enqueue', '* * * * *', 'select public.crm_campaign_enqueue_due(5);');
