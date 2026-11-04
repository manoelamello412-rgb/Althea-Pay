-- Fase 6: e-mail Resend + templates de e-mail. Tabelas mínimas; helpers de render reais.
alter table public.crm_channel_message_outbox add column if not exists organization_id uuid;
create table public.crm_message_templates(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, name text, channel text,
  trigger_event text, subject text, body text not null, variables text[] not null default '{}', whatsapp_template_name text, language text not null default 'pt_BR',
  active boolean not null default true, whatsapp_header_type text, whatsapp_header_url text, whatsapp_buttons jsonb, whatsapp_template_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (organization_id, name));
create table public.crm_campaigns(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, name text, channel_account_id uuid,
  template_id uuid, segment_id uuid, list_id uuid, message text, audio_path text, status text, scheduled_at timestamptz, enqueued_at timestamptz,
  recipient_count int default 0, updated_at timestamptz default now());
create function private.crm_campaign_audience(p_organization_id uuid, p_segment_id uuid, p_channel text)
returns table(conversation_id uuid, address text, display_name text, email text, phone text) language sql as $$
  select null::uuid, 'ana@x.com', 'Ana Souza', 'ana@x.com', null::text $$;
create function private.crm_list_audience(uuid, uuid, uuid, text, uuid)
returns table(conversation_id uuid, address text, display_name text, email text, phone text) language sql as $$ select null::uuid, null, null, null, null where false $$;
create function private.crm_campaign_checkout_context(uuid, uuid, uuid, text) returns jsonb language sql as $$
  select '{"link":"https://pay.x/c/1","valor":"R$ 10,00"}'::jsonb $$;
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
create or replace function public.crm_channel_account_credentials(p_account_id uuid) returns jsonb language sql security definer
set search_path = pg_catalog, public, private as $function$
  select private.crm_whatsapp_secret(nullif(metadata->>'vault_secret_id', '')::uuid) from public.crm_channel_accounts where id = p_account_id;
$function$;
