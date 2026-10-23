-- Remarketing: checkout links with a custom price, and campaign text written on the campaign itself.
--
-- Links: a link is a funnel offer of type 'remarketing' with the price typed in. The public checkout already
-- takes ?offer=<id> and charges the offer price server side (checkout session amount = offer price), so the
-- buyer cannot change the value through the URL. Pausing the offer kills the link.
--
-- Campaign text: crm_campaigns.message is the campaign's own text, independent from the templates.
-- {nome} {primeiro_nome} {email} {telefone} {link} {valor} {produto} are filled per contact.
-- The template becomes optional and only says which approved WhatsApp template goes out when the
-- channel requires one (Infobip / WhatsApp Business API outside the 24h window): with an approved
-- template the dispatcher sends that template, otherwise it sends the campaign text.

alter table public.funnel_offers drop constraint if exists funnel_offers_offer_type_check;
alter table public.funnel_offers add constraint funnel_offers_offer_type_check
  check (offer_type in ('primary','order_bump','upsell','downsell','cross_sell','remarketing'));

create or replace function public.crm_checkout_link_create(p_funnel_id text, p_price numeric, p_name text default null)
returns public.funnel_offers
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  f record;
  v_primary record;
  v public.funnel_offers;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if p_price is null or p_price <= 0 or p_price > 1000000 or p_price <> round(p_price, 2) then
    raise exception 'CHECKOUT_LINK_PRICE_INVALID' using errcode = '22023';
  end if;
  select id, nome, user_id into f from public.funnels
   where id = p_funnel_id and organization_id = c.organization_id and deleted_at is null;
  if not found then raise exception 'FUNNEL_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Same product and currency the funnel's main offer sells.
  select product_id, currency into v_primary from public.funnel_offers
   where funnel_id = f.id and organization_id = c.organization_id and lower(status) = 'active' and offer_type in ('primary', 'main')
   order by created_at limit 1;
  if not found then raise exception 'FUNNEL_OFFER_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.funnel_offers (funnel_id, user_id, organization_id, product_id, offer_type, name, price, currency, status, config)
  values (f.id, f.user_id, c.organization_id, v_primary.product_id, 'remarketing',
          left(coalesce(nullif(btrim(p_name), ''), f.nome), 120), p_price, v_primary.currency, 'active',
          jsonb_build_object('source', 'remarketing_link', 'created_by', auth.uid()))
  returning * into v;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.checkout_link.created', 'funnel_offer', v.id::text,
          jsonb_build_object('funnel_id', f.id, 'price', v.price, 'currency', v.currency, 'name', v.name));
  return v;
end;
$function$;

create or replace function public.crm_checkout_link_set_active(p_offer_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  update public.funnel_offers set status = case when p_active then 'active' else 'paused' end, updated_at = now()
   where id = p_offer_id and organization_id = c.organization_id and offer_type = 'remarketing';
  if not found then raise exception 'CHECKOUT_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.checkout_link.' || case when p_active then 'activated' else 'paused' end,
          'funnel_offer', p_offer_id::text, '{}'::jsonb);
end;
$function$;

revoke all on function public.crm_checkout_link_create(text, numeric, text) from public, anon;
revoke all on function public.crm_checkout_link_set_active(uuid, boolean) from public, anon;
grant execute on function public.crm_checkout_link_create(text, numeric, text) to authenticated;
grant execute on function public.crm_checkout_link_set_active(uuid, boolean) to authenticated;

alter table public.crm_campaigns add column if not exists message text;
alter table public.crm_campaigns drop constraint if exists crm_campaigns_message_check;
alter table public.crm_campaigns add constraint crm_campaigns_message_check check (message is null or length(message) between 1 and 4000);
alter table public.crm_campaigns alter column template_id drop not null;
alter table public.crm_campaigns drop constraint if exists crm_campaigns_content_check;
alter table public.crm_campaigns add constraint crm_campaigns_content_check check (num_nonnulls(template_id, message) >= 1);

-- {chave} placeholders of the campaign text.
create or replace function private.crm_render_named(p_body text, p_context jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_body text := p_body;
  k text;
begin
  if v_body is null then return null; end if;
  foreach k in array array['nome', 'primeiro_nome', 'email', 'telefone', 'link', 'valor', 'produto'] loop
    v_body := replace(v_body, '{' || k || '}', coalesce(p_context->>k, ''));
  end loop;
  return v_body;
end;
$function$;

drop function if exists public.crm_campaign_save(uuid, text, uuid, uuid, uuid, uuid, text);
create or replace function public.crm_campaign_save(p_id uuid, p_name text, p_channel_account_id uuid, p_template_id uuid,
  p_segment_id uuid default null, p_list_id uuid default null, p_audio_path text default null, p_message text default null)
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
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if btrim(coalesce(p_name, '')) = '' then raise exception 'CAMPAIGN_NAME_INVALID' using errcode = '22023'; end if;
  if v_message is null and p_template_id is null then raise exception 'CAMPAIGN_CONTENT_REQUIRED' using errcode = '22023'; end if;
  if length(v_message) > 4000 then raise exception 'CAMPAIGN_MESSAGE_TOO_LONG' using errcode = '22001'; end if;
  select a.channel into v_channel from public.crm_channel_accounts a
   where a.id = p_channel_account_id and a.organization_id = c.organization_id;
  if v_channel is null
     or (p_template_id is not null and not exists (select 1 from public.crm_message_templates t
          where t.id = p_template_id and t.organization_id = c.organization_id and t.channel = v_channel))
     or num_nonnulls(p_segment_id, p_list_id) <> 1
     or (p_segment_id is not null and not exists (select 1 from public.crm_segments s where s.id = p_segment_id and s.organization_id = c.organization_id))
     or (p_list_id is not null and not exists (select 1 from public.crm_contact_lists l where l.id = p_list_id and l.organization_id = c.organization_id)) then
    raise exception 'CAMPAIGN_REFERENCES_INVALID' using errcode = '22023';
  end if;
  if v_audio is not null and (v_channel <> 'whatsapp' or split_part(v_audio, '/', 1) <> c.organization_id::text) then
    raise exception 'CAMPAIGN_AUDIO_INVALID' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.crm_campaigns (organization_id, user_id, name, channel_account_id, template_id, segment_id, list_id, audio_path, message)
    values (c.organization_id, c.owner_id, btrim(p_name), p_channel_account_id, p_template_id, p_segment_id, p_list_id, v_audio, v_message)
    returning * into v;
  else
    update public.crm_campaigns
       set name = btrim(p_name), channel_account_id = p_channel_account_id, template_id = p_template_id,
           segment_id = p_segment_id, list_id = p_list_id, audio_path = v_audio, message = v_message, updated_at = now()
     where id = p_id and organization_id = c.organization_id and status = 'draft'
    returning * into v;
    if not found then raise exception 'CAMPAIGN_NOT_EDITABLE' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.campaign.saved', 'crm_campaign', v.id::text,
          jsonb_build_object('name', v.name, 'template_id', v.template_id, 'segment_id', v.segment_id, 'list_id', v.list_id,
                             'audio', v.audio_path is not null, 'message', v.message is not null));
  return v;
end;
$function$;
revoke all on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.crm_campaign_save(uuid, text, uuid, uuid, uuid, uuid, text, text) to authenticated;

-- Scheduling no longer needs a template, only an active one when the campaign names it.
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
       and (k.template_id is null or exists (select 1 from public.crm_message_templates t where t.id = k.template_id and t.active))
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

-- Same as 20261014180000; channel comes from the account, the body from the campaign text when there is one.
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
    select cp.*, a.channel, t.body, t.subject, t.variables, t.whatsapp_template_name, t.language
      from public.crm_campaigns cp
      join public.crm_channel_accounts a on a.id = cp.channel_account_id
      left join public.crm_message_templates t on t.id = cp.template_id
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
      -- Checkout lookup only when the text uses it, so plain campaigns stay one query per recipient.
      if coalesce(k.variables && array['link', 'valor', 'produto'], false) or coalesce(k.message ~ '\{(link|valor|produto)\}', false) then
        v_ctx := v_ctx || coalesce(private.crm_campaign_checkout_context(k.user_id, k.organization_id, r.conversation_id,
          coalesce(r.email, (select buyer_email from public.crm_conversations where id = r.conversation_id))), '{}'::jsonb);
      end if;
      insert into public.crm_channel_message_outbox(user_id, organization_id, conversation_id, channel_account_id, channel, direction, body, status, next_attempt_at, idempotency_key, metadata)
      values (k.user_id, k.organization_id, r.conversation_id, k.channel_account_id, k.channel, 'outbound',
              coalesce(private.crm_render_named(k.message, v_ctx), private.crm_render_template(k.body, k.variables, v_ctx)),
              'queued', now() + make_interval(secs => v_offset),
              'campaign:' || k.id || ':' || r.address,
              jsonb_build_object('source', 'campaign', 'campaign_id', k.id,
                'email_subject', coalesce(private.crm_render_template(k.subject, k.variables, v_ctx), k.name))
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
