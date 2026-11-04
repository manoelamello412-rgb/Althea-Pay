-- E-mail pela Resend configurável na tela (CRM > Configurações > E-mail) e templates de e-mail
-- com cabeçalho (imagem) e botão, como os do WhatsApp. A API key fica no Vault, igual à Infobip;
-- crm_channel_account_credentials (metadata.vault_secret_id) já serve ao dispatcher.

alter table public.crm_message_templates
  add column if not exists email_header_url text,
  add column if not exists email_button_text text,
  add column if not exists email_button_url text;
alter table public.crm_message_templates drop constraint if exists crm_message_templates_email_layout_check;
alter table public.crm_message_templates add constraint crm_message_templates_email_layout_check check (
  (email_header_url is null or (length(email_header_url) <= 2000 and email_header_url ~ '^https://[^\s<>"]+$'))
  and (email_button_text is null or length(email_button_text) <= 60)
  and (email_button_url is null or (length(email_button_url) <= 2000 and email_button_url ~ '^(https?://[^\s<>"]+|\{link\}|\{\{\d+\}\})$'))
  and ((email_button_text is null) = (email_button_url is null)));

drop function if exists public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text, jsonb, jsonb);
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
  p_active boolean default true,
  p_whatsapp_header_type text default null,
  p_whatsapp_header_url text default null,
  p_whatsapp_buttons jsonb default null,
  p_whatsapp_template_data jsonb default null,
  p_email_header_url text default null,
  p_email_button_text text default null,
  p_email_button_url text default null
)
returns public.crm_message_templates
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_message_templates;
  v_header_type text := nullif(btrim(p_whatsapp_header_type), '');
  v_header_url text := case when nullif(btrim(p_whatsapp_header_type), '') is null then null else nullif(btrim(p_whatsapp_header_url), '') end;
  v_buttons jsonb := case when jsonb_typeof(p_whatsapp_buttons) = 'array' and jsonb_array_length(p_whatsapp_buttons) > 0 then p_whatsapp_buttons end;
  v_data jsonb := case when jsonb_typeof(p_whatsapp_template_data) = 'object' and p_whatsapp_template_data <> '{}'::jsonb then p_whatsapp_template_data end;
  v_mail_header text := case when p_channel = 'email' then nullif(btrim(p_email_header_url), '') end;
  v_mail_text text := case when p_channel = 'email' then nullif(btrim(p_email_button_text), '') end;
  v_mail_url text := case when p_channel = 'email' and nullif(btrim(p_email_button_text), '') is not null then coalesce(nullif(btrim(p_email_button_url), ''), '{link}') end;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  begin
    if p_id is null then
      insert into public.crm_message_templates(organization_id, user_id, name, channel, body, variables, subject, whatsapp_template_name, language, trigger_event, active,
                                               whatsapp_header_type, whatsapp_header_url, whatsapp_buttons, whatsapp_template_data,
                                               email_header_url, email_button_text, email_button_url)
      values (c.organization_id, c.owner_id, btrim(p_name), p_channel, btrim(p_body), coalesce(p_variables, '{}'), nullif(btrim(p_subject), ''),
              nullif(btrim(p_whatsapp_template_name), ''), coalesce(nullif(btrim(p_language), ''), 'pt_BR'), nullif(p_trigger_event, ''), coalesce(p_active, true),
              v_header_type, v_header_url, v_buttons, v_data, v_mail_header, v_mail_text, v_mail_url)
      returning * into v;
    else
      update public.crm_message_templates
         set name = btrim(p_name), channel = p_channel, body = btrim(p_body), variables = coalesce(p_variables, '{}'),
             subject = nullif(btrim(p_subject), ''), whatsapp_template_name = nullif(btrim(p_whatsapp_template_name), ''),
             language = coalesce(nullif(btrim(p_language), ''), 'pt_BR'), trigger_event = nullif(p_trigger_event, ''),
             active = coalesce(p_active, true), whatsapp_header_type = v_header_type, whatsapp_header_url = v_header_url,
             whatsapp_buttons = v_buttons, whatsapp_template_data = v_data,
             email_header_url = v_mail_header, email_button_text = v_mail_text, email_button_url = v_mail_url, updated_at = now()
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

revoke all on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text, jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text, jsonb, jsonb, text, text, text) to authenticated;

-- Contas de e-mail (Resend) da organização. Nunca devolve a API key, só se ela existe.
create or replace function public.crm_email_settings()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'status', a.status, 'display_name', a.display_name,
             'from_email', a.metadata->>'from_email', 'from_name', a.metadata->>'from_name', 'reply_to', a.metadata->>'reply_to',
             'has_api_key', coalesce(private.crm_whatsapp_secret(nullif(a.metadata->>'vault_secret_id', '')::uuid)->>'api_key', '') <> '' or a.credentials_ref is not null,
             'last_error', (select o.last_error from public.crm_channel_message_outbox o
                             where o.channel_account_id = a.id and o.status = 'failed'
                             order by o.updated_at desc limit 1))
           order by a.created_at)
      from public.crm_channel_accounts a
     where a.organization_id = c.organization_id and a.channel = 'email' and a.provider = 'resend'), '[]'::jsonb);
end;
$function$;

-- p_account_id null = nova conta. A API key em branco mantém a atual.
create or replace function public.crm_email_configure(
  p_from_email text,
  p_from_name text default null,
  p_reply_to text default null,
  p_api_key text default null,
  p_account_id uuid default null,
  p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $function$
declare
  c record;
  a public.crm_channel_accounts;
  v_from text := lower(btrim(coalesce(p_from_email, '')));
  v_reply text := nullif(lower(btrim(coalesce(p_reply_to, ''))), '');
  v_sender text := nullif(regexp_replace(btrim(coalesce(p_from_name, '')), '["<>\r\n]', '', 'g'), '');
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_key text := nullif(btrim(coalesce(p_api_key, '')), '');
  v_secret_id uuid;
  v_pattern text := '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$';
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if v_from !~ v_pattern or length(v_from) > 254 then raise exception 'EMAIL_FROM_INVALID' using errcode = '22023'; end if;
  if v_reply is not null and (v_reply !~ v_pattern or length(v_reply) > 254) then raise exception 'EMAIL_REPLY_TO_INVALID' using errcode = '22023'; end if;
  if length(coalesce(v_sender, '')) > 80 or length(coalesce(v_name, '')) > 120 then raise exception 'DISPLAY_NAME_TOO_LONG' using errcode = '22001'; end if;
  if v_key is not null and v_key !~ '^re_[A-Za-z0-9_]{10,200}$' then raise exception 'RESEND_API_KEY_INVALID' using errcode = '22023'; end if;
  if exists (select 1 from public.crm_channel_accounts o
              where o.organization_id = c.organization_id and o.channel = 'email' and o.provider = 'resend'
                and o.external_account_id = v_from and o.id is distinct from p_account_id) then
    raise exception 'EMAIL_FROM_TAKEN' using errcode = '23505';
  end if;

  if p_account_id is null then
    if v_key is null then raise exception 'RESEND_API_KEY_REQUIRED' using errcode = '22023'; end if;
    insert into public.crm_channel_accounts (user_id, organization_id, channel, provider, display_name, status)
    values (c.owner_id, c.organization_id, 'email', 'resend', coalesce(v_name, v_sender, v_from), 'active')
    returning * into a;
  else
    select * into a from public.crm_channel_accounts
     where id = p_account_id and organization_id = c.organization_id and channel = 'email' and provider = 'resend' for update;
    if not found then raise exception 'CHANNEL_ACCOUNT_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;

  v_secret_id := nullif(a.metadata->>'vault_secret_id', '')::uuid;
  if v_key is not null then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(jsonb_build_object('api_key', v_key)::text, 'crm_email_resend:' || a.id, 'Althea CRM e-mail Resend credential');
    else
      perform vault.update_secret(v_secret_id, jsonb_build_object('api_key', v_key)::text);
    end if;
  elsif coalesce(private.crm_whatsapp_secret(v_secret_id)->>'api_key', '') = '' and a.credentials_ref is null then
    raise exception 'RESEND_API_KEY_REQUIRED' using errcode = '22023';
  end if;

  update public.crm_channel_accounts
     set external_account_id = v_from, display_name = coalesce(v_name, display_name), updated_at = now(),
         metadata = (metadata - 'from_name' - 'reply_to')
                    || jsonb_build_object('from_email', v_from, 'vault_secret_id', v_secret_id)
                    || case when v_sender is not null then jsonb_build_object('from_name', v_sender) else '{}'::jsonb end
                    || case when v_reply is not null then jsonb_build_object('reply_to', v_reply) else '{}'::jsonb end
   where id = a.id;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.email.configured', 'crm_channel_account', a.id::text,
          jsonb_build_object('provider', 'resend', 'created', p_account_id is null, 'key_changed', v_key is not null));
  return (select e from jsonb_array_elements(public.crm_email_settings()) e where e->>'id' = a.id::text);
end;
$function$;

revoke all on function public.crm_email_settings() from public, anon;
revoke all on function public.crm_email_configure(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.crm_email_settings() to authenticated;
grant execute on function public.crm_email_configure(text, text, text, text, uuid, text) to authenticated;

-- Igual a 20261023123000, mais o cabeçalho e o botão dos templates de e-mail.
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
    select cp.*, a.channel, t.body, t.subject, t.variables, t.whatsapp_template_name, t.language,
           t.email_header_url, t.email_button_text, t.email_button_url
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
      if coalesce(k.variables && array['link', 'valor', 'produto'], false) or coalesce(k.message ~ '\{(link|valor|produto)\}', false)
         or coalesce(k.email_button_url ~ '\{(link|valor|produto)\}', false) then
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
              || case when k.channel = 'email' and k.email_header_url is not null then jsonb_build_object('email_header_url', k.email_header_url) else '{}'::jsonb end
              || case when k.channel = 'email' and k.email_button_text is not null and k.email_button_url is not null then jsonb_build_object('email_button', jsonb_build_object(
                   'text', k.email_button_text,
                   'url', private.crm_render_named(private.crm_render_template(k.email_button_url, k.variables, v_ctx), v_ctx)))
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

