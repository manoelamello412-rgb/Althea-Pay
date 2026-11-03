-- Fase 1.1: vários números de WhatsApp por organização (cada um Baileys ou Infobip).
-- O provedor é fixo por número: para trocar, adiciona-se outro número. Isso elimina o bug
-- de o "Conectar WhatsApp" virar a org para Baileys antes de o QR ser lido.

drop index if exists public.crm_channel_accounts_one_whatsapp_per_org;

drop function if exists public.crm_whatsapp_settings();
drop function if exists public.crm_whatsapp_configure(text, text, text, text);

create or replace function public.crm_whatsapp_settings()
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
             'id', a.id, 'provider', a.provider, 'status', a.status, 'display_name', a.display_name,
             'phone', a.external_account_id,
             'base_url', a.metadata->>'base_url', 'from_number', a.metadata->>'from_number',
             'has_api_key', coalesce(s->>'api_key', '') <> '' or a.credentials_ref is not null,
             'webhook_token', s->>'webhook_token',
             'last_inbound_at', (select max(m.created_at) from public.crm_messages m
                                  where m.user_id = a.user_id and m.channel = 'whatsapp'
                                    and m.channel_account_id = a.id::text and m.direction = 'inbound'),
             'last_error', (select o.last_error from public.crm_channel_message_outbox o
                             where o.channel_account_id = a.id and o.status = 'failed'
                             order by o.updated_at desc limit 1))
           order by a.created_at)
      from public.crm_channel_accounts a
      cross join lateral (select private.crm_whatsapp_secret(nullif(a.metadata->>'vault_secret_id', '')::uuid) s) x
     where a.organization_id = c.organization_id and a.channel = 'whatsapp'), '[]'::jsonb);
end;
$function$;

-- p_account_id null = novo número. Baileys nasce 'inactive' e só vira 'active' depois de pareado
-- (a rota /api/crm/whatsapp ativa quando o bridge responde "connected").
create or replace function public.crm_whatsapp_configure(
  p_provider text,
  p_base_url text default null,
  p_from_number text default null,
  p_api_key text default null,
  p_account_id uuid default null,
  p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault, extensions
as $function$
declare
  c record;
  a public.crm_channel_accounts;
  v_base text := lower(regexp_replace(btrim(coalesce(p_base_url, '')), '^(https?://)?([^/]+)/*$', '\2'));
  v_from text := regexp_replace(coalesce(p_from_number, ''), '\D', '', 'g');
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_secret_id uuid;
  v_secret jsonb;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if p_provider not in ('baileys', 'infobip') then raise exception 'WHATSAPP_PROVIDER_INVALID' using errcode = '22023'; end if;
  if length(coalesce(v_name, '')) > 120 then raise exception 'DISPLAY_NAME_TOO_LONG' using errcode = '22001'; end if;

  if p_account_id is null then
    insert into public.crm_channel_accounts (user_id, organization_id, channel, provider, display_name, status)
    values (c.owner_id, c.organization_id, 'whatsapp', p_provider, coalesce(v_name, 'WhatsApp'),
            case when p_provider = 'baileys' then 'inactive' else 'active' end)
    returning * into a;
  else
    select * into a from public.crm_channel_accounts
     where id = p_account_id and organization_id = c.organization_id and channel = 'whatsapp' for update;
    if not found then raise exception 'CHANNEL_ACCOUNT_NOT_FOUND' using errcode = 'P0002'; end if;
    if a.provider <> p_provider then raise exception 'WHATSAPP_PROVIDER_LOCKED' using errcode = '22023'; end if;
    if v_name is not null then update public.crm_channel_accounts set display_name = v_name where id = a.id; end if;
  end if;

  if p_provider = 'infobip' then
    -- Só hosts da Infobip: a API key é enviada para esta URL.
    if v_base !~ '^[a-z0-9-]+\.api\.infobip\.com$' then raise exception 'INFOBIP_BASE_URL_INVALID' using errcode = '22023'; end if;
    if length(v_from) in (10, 11) then v_from := '55' || v_from; end if;
    if length(v_from) not between 12 and 15 then raise exception 'WHATSAPP_NUMBER_INVALID' using errcode = '22023'; end if;
    if exists (select 1 from public.crm_channel_accounts o
                where o.organization_id = c.organization_id and o.channel = 'whatsapp'
                  and o.id <> a.id and o.external_account_id = v_from) then
      raise exception 'WHATSAPP_NUMBER_TAKEN' using errcode = '23505';
    end if;
    v_secret_id := nullif(a.metadata->>'vault_secret_id', '')::uuid;
    v_secret := private.crm_whatsapp_secret(v_secret_id);
    if nullif(btrim(coalesce(p_api_key, '')), '') is not null then
      v_secret := jsonb_build_object('api_key', btrim(p_api_key),
        'webhook_token', coalesce(v_secret->>'webhook_token', encode(gen_random_bytes(24), 'hex')));
      if v_secret_id is null then
        v_secret_id := vault.create_secret(v_secret::text, 'crm_whatsapp_infobip:' || a.id, 'Althea CRM WhatsApp Infobip credential');
      else
        perform vault.update_secret(v_secret_id, v_secret::text);
      end if;
    elsif coalesce(v_secret->>'api_key', '') = '' and a.credentials_ref is null then
      raise exception 'INFOBIP_API_KEY_REQUIRED' using errcode = '22023';
    end if;
    update public.crm_channel_accounts
       set external_account_id = v_from, updated_at = now(),
           metadata = metadata || jsonb_build_object('base_url', 'https://' || v_base, 'from_number', v_from, 'vault_secret_id', v_secret_id)
     where id = a.id;
  end if;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.whatsapp.configured', 'crm_channel_account', a.id::text,
          jsonb_build_object('provider', p_provider, 'created', p_account_id is null));
  return (select e from jsonb_array_elements(public.crm_whatsapp_settings()) e where e->>'id' = a.id::text);
end;
$function$;

-- Chamado pela rota do Baileys quando o bridge confirma o pareamento: ativa a conta e guarda o número.
create or replace function public.crm_whatsapp_mark_paired(p_account_id uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare c record;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  update public.crm_channel_accounts
     set status = 'active', external_account_id = nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), updated_at = now()
   where id = p_account_id and organization_id = c.organization_id and channel = 'whatsapp' and provider = 'baileys'
     and (status <> 'active' or external_account_id is distinct from nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''));
end;
$function$;

revoke all on function public.crm_whatsapp_settings() from public, anon;
revoke all on function public.crm_whatsapp_configure(text, text, text, text, uuid, text) from public, anon;
revoke all on function public.crm_whatsapp_mark_paired(uuid, text) from public, anon;
grant execute on function public.crm_whatsapp_settings() to authenticated;
grant execute on function public.crm_whatsapp_configure(text, text, text, text, uuid, text) to authenticated;
grant execute on function public.crm_whatsapp_mark_paired(uuid, text) to authenticated;
