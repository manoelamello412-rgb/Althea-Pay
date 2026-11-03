-- Fase 1.2–1.5 do CRM:
--   * mídia do WhatsApp no bucket chat-attachments (áudio/vídeo, até 16MB);
--   * bloquear contato, apagar conversa, fixar como importante;
--   * limpeza de 48h (mantém pagas, com comprovante, fixadas e em atendimento);
--   * resposta automática por menu no chat do funil (nunca no WhatsApp);
--   * abas Hoje / Pagos / Bloqueados e origem + funil na lista.

-- 1. Bucket: mídia recebida pelo WhatsApp. O upload público do funil continua limitado pela
--    própria RPC (jpg/png/webp/pdf, 4MB).
update storage.buckets
   set file_size_limit = 16777216,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf',
                                  'audio/ogg','audio/mpeg','audio/mp4','audio/aac','video/mp4']
 where id = 'chat-attachments';

-- 2. Colunas e tabela de bloqueio.
alter table public.crm_conversations add column if not exists blocked boolean not null default false;
alter table public.crm_conversations add column if not exists pinned boolean not null default false;
create index if not exists crm_conversations_purge_idx
  on public.crm_conversations (coalesce(last_message_at, updated_at)) where not pinned;

create table if not exists public.crm_blocked_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_digits text,
  email text,
  customer_id uuid,
  display_name text,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (phone_digits is not null or email is not null or customer_id is not null)
);
create unique index if not exists crm_blocked_contacts_phone_uq on public.crm_blocked_contacts (organization_id, phone_digits) where phone_digits is not null;
create unique index if not exists crm_blocked_contacts_email_uq on public.crm_blocked_contacts (organization_id, email) where email is not null;
create unique index if not exists crm_blocked_contacts_customer_uq on public.crm_blocked_contacts (organization_id, customer_id) where customer_id is not null;
alter table public.crm_blocked_contacts enable row level security;
drop policy if exists crm_blocked_contacts_read on public.crm_blocked_contacts;
create policy crm_blocked_contacts_read on public.crm_blocked_contacts for select to authenticated
  using (private.has_org_capability(organization_id, 'can_view_chats'));
revoke insert, update, delete on public.crm_blocked_contacts from anon, authenticated;
grant select on public.crm_blocked_contacts to authenticated;

create or replace function private.crm_phone_digits(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;

create or replace function private.crm_contact_is_blocked(p_org uuid, p_phone text, p_email text, p_customer uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$
  select p_org is not null and exists (
    select 1 from public.crm_blocked_contacts b
     where b.organization_id = p_org
       and ((b.phone_digits is not null and b.phone_digits = private.crm_phone_digits(p_phone))
         or (b.email is not null and b.email = lower(nullif(btrim(p_email), '')))
         or (b.customer_id is not null and b.customer_id = p_customer)))
$$;

-- Conversa nova de contato bloqueado já nasce em "Bloqueados". "zz_" roda depois do trigger
-- que preenche organization_id.
create or replace function private.crm_conversation_flag_blocked()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if private.crm_contact_is_blocked(new.organization_id, new.customer_whatsapp, new.buyer_email, new.customer_id) then
    new.blocked := true;
  end if;
  return new;
end $$;
drop trigger if exists zz_crm_conversation_flag_blocked on public.crm_conversations;
create trigger zz_crm_conversation_flag_blocked before insert or update of customer_whatsapp, buyer_email, customer_id
  on public.crm_conversations for each row execute function private.crm_conversation_flag_blocked();

-- Mensagem de bloqueado não acende "não lida". "zz_" roda depois do touch que incrementa.
create or replace function private.crm_blocked_quiet()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.direction = 'inbound' then
    update public.crm_conversations set unread_count = 0 where id = new.conversation_id and blocked and unread_count <> 0;
  end if;
  return null;
end $$;
drop trigger if exists zz_crm_blocked_quiet on public.crm_messages;
create trigger zz_crm_blocked_quiet after insert on public.crm_messages for each row execute function private.crm_blocked_quiet();

-- 3. Ações do operador.
create or replace function public.crm_contact_block(p_conversation_id uuid, p_block boolean default true, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_org uuid := private.current_organization_id();
  c public.crm_conversations;
  v_phone text; v_email text; n integer;
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into c from public.crm_conversations where id = p_conversation_id and organization_id = v_org;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  v_phone := private.crm_phone_digits(c.customer_whatsapp);
  v_email := lower(nullif(btrim(c.buyer_email), ''));

  if p_block then
    if v_phone is not null then
      insert into public.crm_blocked_contacts (organization_id, phone_digits, display_name, reason, created_by)
      values (v_org, v_phone, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if v_email is not null then
      insert into public.crm_blocked_contacts (organization_id, email, display_name, reason, created_by)
      values (v_org, v_email, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if c.customer_id is not null then
      insert into public.crm_blocked_contacts (organization_id, customer_id, display_name, reason, created_by)
      values (v_org, c.customer_id, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if v_phone is null and v_email is null and c.customer_id is null then
      raise exception 'CONTACT_NOT_IDENTIFIED' using errcode = '22023';
    end if;
  else
    delete from public.crm_blocked_contacts b
     where b.organization_id = v_org
       and (b.phone_digits = v_phone or b.email = v_email or b.customer_id = c.customer_id);
  end if;

  update public.crm_conversations x
     set blocked = p_block, unread_count = case when p_block then 0 else x.unread_count end, updated_at = now()
   where x.organization_id = v_org
     and (x.id = c.id
       or (v_phone is not null and private.crm_phone_digits(x.customer_whatsapp) = v_phone)
       or (v_email is not null and lower(x.buyer_email) = v_email)
       or (c.customer_id is not null and x.customer_id = c.customer_id));
  get diagnostics n = row_count;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.user_id, auth.uid(), v_org, case when p_block then 'crm.contact.blocked' else 'crm.contact.unblocked' end,
          'crm_conversation', c.id::text, jsonb_build_object('conversations', n));
  return jsonb_build_object('blocked', p_block, 'conversations', n);
end $$;

create or replace function public.crm_conversation_set_pinned(p_conversation_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.crm_conversations set pinned = p_pinned where id = p_conversation_id and organization_id = v_org;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.crm_conversation_delete(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_org uuid := private.current_organization_id();
  c public.crm_conversations;
begin
  if v_org is null or not private.has_org_role(v_org, array['owner', 'admin', 'manager']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.crm_conversations where id = p_conversation_id and organization_id = v_org returning * into c;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.user_id, auth.uid(), v_org, 'crm.conversation.deleted', 'crm_conversation', c.id::text,
          jsonb_build_object('channel', c.primary_channel, 'buyer_name', c.buyer_name));
exception when foreign_key_violation then
  raise exception 'CONVERSATION_IN_USE' using errcode = '23503';
end $$;

-- 4. "Paga": transação aprovada ou comprovante anexado. Usada pela aba Pagos e pela limpeza.
create or replace function private.crm_conversation_is_paid(p_conversation_id uuid, p_transaction_id text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.gateway_transactions t
                  where p_transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    and t.id = p_transaction_id::uuid and t.status = 'approved')
      or exists (select 1 from public.crm_messages m
                  where m.conversation_id = p_conversation_id and m.metadata->'attachment'->>'kind' = 'transfer_receipt')
$$;

-- 5. Limpeza de 48h. Mantém: fixadas, pagas/comprovante, e abertas com atendente atribuído.
--    O bloqueio fica em crm_blocked_contacts, então continua valendo depois da limpeza.
--    ponytail: arquivos de mídia das conversas apagadas ficam no storage (o Supabase não deixa
--    apagar storage.objects por SQL); adicionar um worker de limpeza se o bucket crescer.
create or replace function private.crm_conversations_purge_48h(p_limit integer default 2000)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare r record; n integer := 0;
begin
  for r in
    select c.id from public.crm_conversations c
     where not c.pinned
       and coalesce(c.last_message_at, c.updated_at) < now() - interval '48 hours'
       and not (c.status = 'open' and c.assigned_to is not null)
       and not private.crm_conversation_is_paid(c.id, c.transaction_id)
     order by coalesce(c.last_message_at, c.updated_at)
     limit greatest(1, least(coalesce(p_limit, 2000), 10000))
  loop
    begin
      delete from public.crm_conversations where id = r.id;
      n := n + 1;
    exception when foreign_key_violation then null; -- referenciada por algo que não pode sumir: fica
    end;
  end loop;
  return n;
end $$;
revoke all on function private.crm_conversations_purge_48h(integer) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'althea-crm-purge-48h';
  perform cron.schedule('althea-crm-purge-48h', '23 * * * *', 'select private.crm_conversations_purge_48h(2000);');
end $$;

-- 6. Resposta automática do chat do funil (menu numerado; funciona com qualquer widget).
--    No WhatsApp nada é automático: o trigger só age em conversas primary_channel = 'funnel_chat'.
create table if not exists public.crm_funnel_chat_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id text,
  enabled boolean not null default true,
  texts jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_funnel_chat_flows_scope_uq on public.crm_funnel_chat_flows (organization_id, coalesce(funnel_id, ''));
alter table public.crm_funnel_chat_flows enable row level security;
drop policy if exists crm_funnel_chat_flows_read on public.crm_funnel_chat_flows;
create policy crm_funnel_chat_flows_read on public.crm_funnel_chat_flows for select to authenticated
  using (private.has_org_capability(organization_id, 'can_view_chats'));
revoke insert, update, delete on public.crm_funnel_chat_flows from anon, authenticated;
grant select on public.crm_funnel_chat_flows to authenticated;

create or replace function private.crm_funnel_chat_default_texts()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'welcome', E'Olá{nome}! 👋 Você está falando com o atendimento automático de {funil}.\nResponda com o número da opção:\n1 - Ver status do meu pagamento\n2 - Enviar comprovante\n3 - Falar com um atendente',
    'status', E'Seu pagamento está: {status}.\nSe você já pagou, envie o comprovante (opção 2). Para falar com alguém, responda 3.',
    'receipt_prompt', 'Envie a foto ou o PDF do comprovante pelo botão de anexo aqui do chat.',
    'receipt_received', 'Recebemos seu comprovante! Um atendente vai conferir e responder por aqui em breve.',
    'human', 'Certo! Um atendente vai continuar o seu atendimento por aqui em instantes.',
    'fallback', E'Não entendi. Responda com o número da opção:\n1 - Ver status do meu pagamento\n2 - Enviar comprovante\n3 - Falar com um atendente')
$$;

create or replace function public.crm_funnel_chat_flow_save(p_funnel_id text, p_enabled boolean, p_texts jsonb)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_texts jsonb := '{}'::jsonb;
  k text;
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_manage_automations') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(private.crm_funnel_chat_default_texts()) loop
    if nullif(btrim(coalesce(p_texts->>k, '')), '') is not null then
      if length(p_texts->>k) > 2000 then raise exception 'TEXT_TOO_LONG' using errcode = '22001'; end if;
      v_texts := v_texts || jsonb_build_object(k, btrim(p_texts->>k));
    end if;
  end loop;
  insert into public.crm_funnel_chat_flows (organization_id, funnel_id, enabled, texts, updated_by, updated_at)
  values (v_org, nullif(btrim(coalesce(p_funnel_id, '')), ''), coalesce(p_enabled, true), v_texts, auth.uid(), now())
  on conflict (organization_id, coalesce(funnel_id, '')) do update
    set enabled = excluded.enabled, texts = excluded.texts, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('enabled', coalesce(p_enabled, true), 'texts', private.crm_funnel_chat_default_texts() || v_texts);
end $$;

create or replace function private.crm_funnel_chat_autoreply()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  c public.crm_conversations;
  f public.crm_funnel_chat_flows;
  t jsonb;
  v_body text := lower(btrim(coalesce(new.body, '')));
  v_reply text;
  v_human boolean := false;
  v_status text;
  v_funnel text;
  v_outbox uuid;
begin
  if new.direction <> 'inbound' then return null; end if;
  select * into c from public.crm_conversations where id = new.conversation_id;
  if not found or coalesce(c.primary_channel, 'funnel_chat') <> 'funnel_chat' or c.blocked or c.status = 'closed'
     or coalesce((c.metadata->>'human_requested')::boolean, false) then
    return null;
  end if;
  -- Um atendente já respondeu: o automático sai de cena.
  if exists (select 1 from public.crm_messages m where m.conversation_id = c.id and m.direction = 'outbound'
               and coalesce(m.metadata->>'source', '') = 'crm_operator') then
    return null;
  end if;

  select * into f from public.crm_funnel_chat_flows x
   where x.organization_id = c.organization_id and (x.funnel_id = c.funnel_id or x.funnel_id is null)
   order by x.funnel_id nulls last limit 1;
  if found and not f.enabled then return null; end if;
  t := private.crm_funnel_chat_default_texts() || coalesce(f.texts, '{}'::jsonb);

  if new.metadata->'attachment'->>'kind' = 'transfer_receipt' then
    v_reply := t->>'receipt_received'; v_human := true;
  elsif not exists (select 1 from public.crm_messages m where m.conversation_id = c.id and m.direction = 'outbound'
                      and coalesce((m.metadata->>'automated')::boolean, false)) then
    v_reply := t->>'welcome';
  elsif v_body ~ '^\s*1(\D|$)' or v_body ~ '(status|pagamento|paguei|pix)' then
    select case t2.status when 'approved' then 'aprovado ✅' when 'pending' then 'aguardando pagamento'
             when 'created' then 'aguardando pagamento' when 'failed' then 'não aprovado'
             when 'refunded' then 'estornado' when 'chargeback' then 'em contestação' else t2.status end
      into v_status
      from public.gateway_transactions t2
     where c.transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and t2.id = c.transaction_id::uuid;
    v_reply := replace(t->>'status', '{status}', coalesce(v_status, 'ainda não encontramos um pagamento para este atendimento'));
  elsif v_body ~ '^\s*2(\D|$)' or v_body ~ 'comprovante' then
    v_reply := t->>'receipt_prompt';
  elsif v_body ~ '^\s*3(\D|$)' or v_body ~ '(atendente|humano|pessoa|suporte)' then
    v_reply := t->>'human'; v_human := true;
  else
    v_reply := t->>'fallback';
  end if;

  select nome into v_funnel from public.funnels where id = c.funnel_id;
  v_reply := replace(replace(v_reply, '{nome}', coalesce(', ' || nullif(split_part(btrim(coalesce(c.buyer_name, '')), ' ', 1), ''), '')),
                     '{funil}', coalesce(v_funnel, 'nossa equipe'));

  insert into public.crm_channel_message_outbox (user_id, conversation_id, channel_account_id, channel, external_message_id,
         idempotency_key, direction, body, status, max_attempts, next_attempt_at, metadata)
  values (c.user_id, c.id, null, 'funnel_chat', null, 'autoreply:' || new.id::text, 'outbound', v_reply, 'queued', 5, now(),
          jsonb_build_object('source', 'automation', 'automated', true, 'reply_to', new.id))
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_outbox;
  if v_outbox is null then return null; end if;

  insert into public.crm_messages (conversation_id, user_id, direction, channel, body, metadata, client_message_id)
  values (c.id, c.user_id, 'outbound', 'funnel_chat', v_reply,
          jsonb_build_object('source', 'automation', 'automated', true, 'outbox_id', v_outbox, 'delivery_status', 'queued'),
          'autoreply:' || new.id::text);

  if v_human then
    update public.crm_conversations
       set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('human_requested', true, 'human_requested_at', now()),
           status = case when status = 'open' then 'pending' else status end,
           priority = case when priority = 'low' then 'normal' else priority end
     where id = c.id;
  end if;
  return null;
exception when others then
  -- Nunca derrubar a entrada da mensagem do cliente por causa do automático.
  raise warning 'crm_funnel_chat_autoreply failed: %', sqlerrm;
  return null;
end $$;
drop trigger if exists zz_crm_funnel_chat_autoreply on public.crm_messages;
create trigger zz_crm_funnel_chat_autoreply after insert on public.crm_messages
  for each row when (new.direction = 'inbound') execute function private.crm_funnel_chat_autoreply();

-- 7. Lista: abas (today/paid/blocked além das existentes), origem e nome do funil.
--    Bloqueadas só aparecem na aba "blocked".
CREATE OR REPLACE FUNCTION public.crm_multicrm_conversations_page(p_limit integer DEFAULT 50, p_cursor_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_filter text DEFAULT 'all'::text, p_agent_id uuid DEFAULT NULL::uuid, p_team_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with ctx as (
    select private.current_organization_id() as organization_id
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
      and (c.updated_at >= now() - make_interval(hours => a.history_hours) or c.pinned)
      and (case when p_filter = 'blocked' then c.blocked else not c.blocked end)
      and (p_filter in ('all','blocked')
        or (p_filter = 'unread' and c.unread_count > 0)
        or (p_filter in ('open','pending','closed') and c.status = p_filter)
        or (p_filter = 'today' and coalesce(c.last_message_at, c.updated_at) >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
        or (p_filter = 'paid' and private.crm_conversation_is_paid(c.id, c.transaction_id))
        or (p_filter = 'pinned' and c.pinned))
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
                                    order by m.created_at desc limit 1),
          -- Funil da conversa; no WhatsApp (sem funil próprio), o funil da transação ligada.
          'funnel_name', coalesce(
            (select f.nome from public.funnels f where f.id = page.funnel_id),
            (select f.nome from public.gateway_transactions t join public.funnels f on f.id = t.funnel_id
              where page.transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and t.id = page.transaction_id::uuid)),
          'source_label', case coalesce(page.primary_channel, 'funnel_chat')
            when 'funnel_chat' then 'Chat do funil'
            when 'whatsapp' then 'WhatsApp' || coalesce(' · ' || (select nullif(a.display_name, 'WhatsApp') from public.crm_channel_accounts a
                                                                  where page.channel_account_id ~* '^[0-9a-f-]{36}$' and a.id = page.channel_account_id::uuid), '')
            when 'email' then 'E-mail' when 'sms' then 'SMS' when 'instagram' then 'Instagram'
            else page.primary_channel end,
          'human_requested', coalesce((page.metadata->>'human_requested')::boolean, false)
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

revoke all on function public.crm_contact_block(uuid, boolean, text) from public, anon;
revoke all on function public.crm_conversation_set_pinned(uuid, boolean) from public, anon;
revoke all on function public.crm_conversation_delete(uuid) from public, anon;
revoke all on function public.crm_funnel_chat_flow_save(text, boolean, jsonb) from public, anon;
grant execute on function public.crm_contact_block(uuid, boolean, text) to authenticated;
grant execute on function public.crm_conversation_set_pinned(uuid, boolean) to authenticated;
grant execute on function public.crm_conversation_delete(uuid) to authenticated;
grant execute on function public.crm_funnel_chat_flow_save(text, boolean, jsonb) to authenticated;
revoke all on function private.crm_contact_is_blocked(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function private.crm_conversation_is_paid(uuid, text) from public, anon, authenticated;
revoke all on function private.crm_conversation_flag_blocked() from public, anon, authenticated;
revoke all on function private.crm_blocked_quiet() from public, anon, authenticated;
revoke all on function private.crm_funnel_chat_autoreply() from public, anon, authenticated;
