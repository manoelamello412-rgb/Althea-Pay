-- Mass sends to a hand-picked list of clients (selected on the Clientes screen), optionally with an
-- audio message before the text. WhatsApp campaign messages are spaced 20–60 s apart so a Baileys
-- number does not burst (the main ban trigger); 50 contacts take ~30 minutes.

create table if not exists public.crm_contact_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.crm_contact_list_members (
  list_id uuid not null references public.crm_contact_lists(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  client_id text not null,
  added_at timestamptz not null default now(),
  primary key (list_id, client_id),
  foreign key (user_id, client_id) references public.clients(user_id, id) on delete cascade
);

alter table public.crm_contact_lists enable row level security;
alter table public.crm_contact_list_members enable row level security;
revoke all on public.crm_contact_lists, public.crm_contact_list_members from anon, authenticated;
grant select on public.crm_contact_lists, public.crm_contact_list_members to authenticated;
drop policy if exists crm_contact_lists_org_select on public.crm_contact_lists;
create policy crm_contact_lists_org_select on public.crm_contact_lists for select to authenticated
  using (private.is_org_member(organization_id));
drop policy if exists crm_contact_list_members_org_select on public.crm_contact_list_members;
create policy crm_contact_list_members_org_select on public.crm_contact_list_members for select to authenticated
  using (private.is_org_member(organization_id));

-- Adds clients to an existing list, or to a list created (or reused) by name.
create or replace function public.crm_contact_list_add(p_list_id uuid, p_name text, p_client_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_id uuid;
  v_name text;
  n integer;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if coalesce(cardinality(p_client_ids), 0) not between 1 and 5000 then raise exception 'LIST_CLIENTS_INVALID' using errcode = '22023'; end if;
  if p_list_id is null then
    if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'LIST_NAME_INVALID' using errcode = '22023'; end if;
    insert into public.crm_contact_lists (organization_id, user_id, name) values (c.organization_id, c.owner_id, btrim(p_name))
    on conflict (organization_id, name) do update set name = excluded.name
    returning id, name into v_id, v_name;
  else
    select id, name into v_id, v_name from public.crm_contact_lists where id = p_list_id and organization_id = c.organization_id;
    if not found then raise exception 'LIST_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into public.crm_contact_list_members (list_id, organization_id, user_id, client_id)
  select v_id, cl.organization_id, cl.user_id, cl.id from public.clients cl
   where cl.organization_id = c.organization_id and cl.id = any(p_client_ids)
  on conflict do nothing;
  get diagnostics n = row_count;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.contact_list.members_added', 'crm_contact_list', v_id::text, jsonb_build_object('added', n));
  return jsonb_build_object('id', v_id, 'name', v_name, 'added', n);
end;
$function$;

create or replace function public.crm_contact_list_remove(p_list_id uuid, p_client_ids text[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  n integer;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  delete from public.crm_contact_list_members
   where list_id = p_list_id and organization_id = c.organization_id and client_id = any(p_client_ids);
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- List members with a usable address on the channel, minus opt-outs. Bare 10–11 digit phones are Brazilian.
-- ponytail: name/e-mail/phone read from clients.data keys (name|full_name|nome, email, phone|whatsapp|mobile).
create or replace function private.crm_list_contacts(p_organization_id uuid, p_list_id uuid, p_channel text)
returns table(client_id text, client_user_id uuid, display_name text, email text, address text)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  select distinct on (a.addr) m.client_id, m.user_id,
         nullif(btrim(coalesce(cl.data->>'name', cl.data->>'full_name', cl.data->>'nome', '')), ''),
         lower(nullif(btrim(coalesce(cl.data->>'email', '')), '')), a.addr
    from public.crm_contact_list_members m
    join public.clients cl on cl.user_id = m.user_id and cl.id = m.client_id
    cross join lateral (select regexp_replace(coalesce(cl.data->>'phone', cl.data->>'whatsapp', cl.data->>'mobile', ''), '\D', '', 'g') as digits) d
    cross join lateral (select case
        when p_channel = 'email' then lower(nullif(btrim(coalesce(cl.data->>'email', '')), ''))
        when length(d.digits) in (10, 11) then '55' || d.digits
        when length(d.digits) between 12 and 15 then d.digits
      end as addr) a
   where m.list_id = p_list_id and m.organization_id = p_organization_id and a.addr is not null
     and not exists (select 1 from public.crm_channel_consents k
                      where k.organization_id = p_organization_id and k.channel = p_channel and k.address = a.addr and k.status = 'opted_out')
   order by a.addr, m.added_at
$function$;
revoke all on function private.crm_list_contacts(uuid, uuid, text) from public, anon, authenticated;

-- Same shape as crm_campaign_audience. The dispatcher needs a conversation and a channel identity per
-- recipient, so contacts never reached on this channel get a WhatsApp conversation (where replies land,
-- like crm_ingest_channel_message does) and an identity.
create or replace function private.crm_list_audience(p_organization_id uuid, p_owner_id uuid, p_list_id uuid, p_channel text, p_account_id uuid)
returns table(conversation_id uuid, address text, display_name text, email text, phone text)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  r record;
  v_conv uuid;
  v_customer text;
begin
  for r in select * from private.crm_list_contacts(p_organization_id, p_list_id, p_channel) loop
    v_conv := null;
    v_customer := case when r.client_user_id = p_owner_id then r.client_id end;
    select i.conversation_id into v_conv from public.crm_channel_identities i
     where i.user_id = p_owner_id and i.channel = p_channel and i.conversation_id is not null
       and private.crm_consent_address(p_channel, case when p_channel = 'email' then i.email else coalesce(i.phone_e164, i.external_user_id) end) = r.address
     order by i.updated_at desc limit 1;
    if v_conv is null and v_customer is not null then
      select cv.id into v_conv from public.crm_conversations cv
       where cv.user_id = p_owner_id and cv.organization_id = p_organization_id and cv.customer_id = v_customer and cv.primary_channel = p_channel
       order by cv.updated_at desc limit 1;
    end if;
    if v_conv is null then
      insert into public.crm_conversations (user_id, organization_id, status, primary_channel, channel_account_id, buyer_name, buyer_email, customer_whatsapp, customer_id, metadata)
      values (p_owner_id, p_organization_id, 'open', p_channel, p_account_id::text, r.display_name, r.email,
              case when p_channel <> 'email' then '+' || r.address end, v_customer, jsonb_build_object('source', 'contact_list', 'list_id', p_list_id))
      returning id into v_conv;
    end if;
    insert into public.crm_channel_identities (user_id, customer_id, conversation_id, channel, external_user_id, phone_e164, email, display_name, metadata, updated_at)
    values (p_owner_id, v_customer, v_conv, p_channel, r.address, case when p_channel <> 'email' then '+' || r.address end, r.email, r.display_name,
            jsonb_build_object('source', 'contact_list'), now())
    on conflict (user_id, channel, external_user_id) do update
      set conversation_id = coalesce(crm_channel_identities.conversation_id, excluded.conversation_id), updated_at = now()
    returning crm_channel_identities.conversation_id into v_conv;
    conversation_id := v_conv; address := r.address; display_name := r.display_name; email := r.email;
    phone := case when p_channel <> 'email' then r.address end;
    return next;
  end loop;
end;
$function$;
revoke all on function private.crm_list_audience(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.crm_list_audience_count(p_list_id uuid, p_channel text)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_view_chats') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (select count(*) from private.crm_list_contacts(v_org, p_list_id, p_channel));
end;
$function$;

-- Campaigns target a segment or a list, and may carry an audio sent before the text.
alter table public.crm_campaigns add column if not exists list_id uuid references public.crm_contact_lists(id) on delete restrict;
alter table public.crm_campaigns add column if not exists audio_path text;
alter table public.crm_campaigns alter column segment_id drop not null;
alter table public.crm_campaigns drop constraint if exists crm_campaigns_audience_check;
alter table public.crm_campaigns add constraint crm_campaigns_audience_check check (num_nonnulls(segment_id, list_id) = 1);
alter table public.crm_campaigns drop constraint if exists crm_campaigns_audio_path_check;
alter table public.crm_campaigns add constraint crm_campaigns_audio_path_check
  check (audio_path is null or audio_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

drop function if exists public.crm_campaign_save(uuid, text, uuid, uuid, uuid);
create or replace function public.crm_campaign_save(p_id uuid, p_name text, p_channel_account_id uuid, p_template_id uuid,
  p_segment_id uuid default null, p_list_id uuid default null, p_audio_path text default null)
returns public.crm_campaigns
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_campaigns;
  v_channel text;
  v_audio text := nullif(btrim(coalesce(p_audio_path, '')), '');
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if btrim(coalesce(p_name, '')) = '' then raise exception 'CAMPAIGN_NAME_INVALID' using errcode = '22023'; end if;
  select a.channel into v_channel from public.crm_channel_accounts a
    join public.crm_message_templates t on t.id = p_template_id and t.organization_id = c.organization_id and t.channel = a.channel
   where a.id = p_channel_account_id and a.organization_id = c.organization_id;
  if v_channel is null
     or num_nonnulls(p_segment_id, p_list_id) <> 1
     or (p_segment_id is not null and not exists (select 1 from public.crm_segments s where s.id = p_segment_id and s.organization_id = c.organization_id))
     or (p_list_id is not null and not exists (select 1 from public.crm_contact_lists l where l.id = p_list_id and l.organization_id = c.organization_id)) then
    raise exception 'CAMPAIGN_REFERENCES_INVALID' using errcode = '22023';
  end if;
  -- Audio lives in the organization's folder of crm-campaign-media and only goes out on WhatsApp.
  if v_audio is not null and (v_channel <> 'whatsapp' or split_part(v_audio, '/', 1) <> c.organization_id::text) then
    raise exception 'CAMPAIGN_AUDIO_INVALID' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.crm_campaigns (organization_id, user_id, name, channel_account_id, template_id, segment_id, list_id, audio_path)
    values (c.organization_id, c.owner_id, btrim(p_name), p_channel_account_id, p_template_id, p_segment_id, p_list_id, v_audio)
    returning * into v;
  else
    update public.crm_campaigns
       set name = btrim(p_name), channel_account_id = p_channel_account_id, template_id = p_template_id,
           segment_id = p_segment_id, list_id = p_list_id, audio_path = v_audio, updated_at = now()
     where id = p_id and organization_id = c.organization_id and status = 'draft'
    returning * into v;
    if not found then raise exception 'CAMPAIGN_NOT_EDITABLE' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.campaign.saved', 'crm_campaign', v.id::text,
          jsonb_build_object('name', v.name, 'template_id', v.template_id, 'segment_id', v.segment_id, 'list_id', v.list_id, 'audio', v.audio_path is not null));
  return v;
end;
$function$;
revoke all on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid, uuid, text) to authenticated;
revoke all on function public.crm_contact_list_add(uuid, text, text[]) from public, anon;
revoke all on function public.crm_contact_list_remove(uuid, text[]) from public, anon;
revoke all on function public.crm_list_audience_count(uuid, text) from public, anon;
grant execute on function public.crm_contact_list_add(uuid, text, text[]) to authenticated;
grant execute on function public.crm_contact_list_remove(uuid, text[]) to authenticated;
grant execute on function public.crm_list_audience_count(uuid, text) to authenticated;

-- 20261014150000 enqueue + list audiences, audio, WhatsApp pacing, and whatsapp_template only when one
-- is named (an empty one makes Infobip reject the send).
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
  v_offset integer;
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
    v_offset := 0;
    for r in
      select * from private.crm_campaign_audience(k.organization_id, k.segment_id, k.channel) where k.segment_id is not null
      union all
      select * from private.crm_list_audience(k.organization_id, k.user_id, k.list_id, k.channel, k.channel_account_id) where k.list_id is not null
    loop
      v_ctx := jsonb_build_object('nome', r.display_name, 'primeiro_nome', split_part(coalesce(r.display_name, ''), ' ', 1), 'email', r.email, 'telefone', r.phone);
      -- Checkout lookup only when the template uses it, so plain campaigns stay one query per recipient.
      if k.variables && array['link', 'valor', 'produto'] then
        v_ctx := v_ctx || coalesce(private.crm_campaign_checkout_context(k.user_id, k.organization_id, r.conversation_id,
          coalesce(r.email, (select buyer_email from public.crm_conversations where id = r.conversation_id))), '{}'::jsonb);
      end if;
      insert into public.crm_channel_message_outbox(user_id, organization_id, conversation_id, channel_account_id, channel, direction, body, status, next_attempt_at, idempotency_key, metadata)
      values (k.user_id, k.organization_id, r.conversation_id, k.channel_account_id, k.channel, 'outbound',
              private.crm_render_template(k.body, k.variables, v_ctx), 'queued', now() + make_interval(secs => v_offset),
              'campaign:' || k.id || ':' || r.address,
              jsonb_build_object('source', 'campaign', 'campaign_id', k.id, 'email_subject', private.crm_render_template(k.subject, k.variables, v_ctx))
              || case when k.channel = 'whatsapp' and k.whatsapp_template_name is not null then jsonb_build_object('whatsapp_template', jsonb_build_object(
                   'name', k.whatsapp_template_name, 'language', k.language, 'placeholders', private.crm_template_placeholders(k.variables, v_ctx)))
                 else '{}'::jsonb end
              || case when k.audio_path is not null then jsonb_build_object('audio_path', k.audio_path) else '{}'::jsonb end)
      on conflict (user_id, idempotency_key) do nothing;
      v_count := v_count + 1;
      if k.channel = 'whatsapp' then v_offset := v_offset + 20 + floor(random() * 41)::integer; end if;
    end loop;
    update public.crm_campaigns set status = 'enqueued', enqueued_at = now(), recipient_count = v_count, updated_at = now() where id = k.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$function$;
revoke all on function public.crm_campaign_enqueue_due(integer) from public, anon, authenticated;
grant execute on function public.crm_campaign_enqueue_due(integer) to service_role;

-- Campaign audio: private bucket, one folder per organization.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-campaign-media', 'crm-campaign-media', false, 16777216,
        array['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/webm'])
on conflict (id) do nothing;

drop policy if exists crm_campaign_media_insert on storage.objects;
create policy crm_campaign_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-campaign-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_manage_automations'));
drop policy if exists crm_campaign_media_read on storage.objects;
create policy crm_campaign_media_read on storage.objects for select to authenticated
  using (bucket_id = 'crm-campaign-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_manage_automations'));
