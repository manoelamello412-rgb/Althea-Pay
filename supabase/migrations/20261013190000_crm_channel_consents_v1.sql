-- Channel consent and opt-out (LGPD, WhatsApp/e-mail sender rules).
-- One row per organization + channel + normalized address. Inbound "SAIR"/"PARAR"/"STOP"
-- opts the contact out, "VOLTAR"/"START" opts back in. The outbox dispatcher refuses to
-- deliver to an opted-out address (dead_letter with recipient_opted_out).
-- Members read by can_view_chats; writes come only from the trigger and service_role.

create table if not exists public.crm_channel_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'sms', 'email')),
  address text not null check (length(address) between 3 and 320),
  status text not null check (status in ('opted_in', 'opted_out')),
  source text not null,
  source_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, address)
);

alter table public.crm_channel_consents enable row level security;
create policy crm_channel_consents_org_select on public.crm_channel_consents for select to authenticated
  using (private.has_org_capability(organization_id, 'can_view_chats'));
revoke all on public.crm_channel_consents from anon, authenticated;
grant select on public.crm_channel_consents to authenticated;

-- Phones compare by digits (Infobip/Meta send "5511...", identities may hold "+5511..."); e-mail by lowercase.
create or replace function private.crm_consent_address(p_channel text, p_address text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_channel = 'email' then nullif(lower(trim(p_address)), '')
    when p_channel in ('whatsapp', 'sms') then nullif(regexp_replace(coalesce(p_address, ''), '\D', '', 'g'), '')
  end
$function$;

create or replace function public.crm_channel_recipient_opted_out(p_organization_id uuid, p_channel text, p_address text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1 from public.crm_channel_consents c
     where c.organization_id = p_organization_id
       and c.channel = p_channel
       and c.address = private.crm_consent_address(p_channel, p_address)
       and c.status = 'opted_out'
  )
$function$;
revoke all on function public.crm_channel_recipient_opted_out(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crm_channel_recipient_opted_out(uuid, text, text) to service_role;

create or replace function private.crm_consent_from_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_keyword text := regexp_replace(upper(coalesce(new.body, '')), '[^A-Z]', '', 'g');
  v_status text;
  v_address text;
begin
  v_status := case
    when v_keyword in ('SAIR', 'PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR') then 'opted_out'
    when v_keyword in ('VOLTAR', 'START') then 'opted_in'
  end;
  if v_status is null then
    return new;
  end if;

  select private.crm_consent_address(new.channel, coalesce(i.phone_e164, i.external_user_id))
    into v_address
    from public.crm_channel_identities i
   where i.conversation_id = new.conversation_id and i.channel = new.channel
   order by i.updated_at desc
   limit 1;
  if v_address is null then
    return new;
  end if;

  insert into public.crm_channel_consents (organization_id, channel, address, status, source, source_message_id)
  values (new.organization_id, new.channel, v_address, v_status, 'inbound_keyword', new.id)
  on conflict (organization_id, channel, address) do update
    set status = excluded.status, source = excluded.source, source_message_id = excluded.source_message_id, updated_at = now();
  return new;
end;
$function$;
revoke all on function private.crm_consent_from_inbound_message() from public, anon, authenticated;

drop trigger if exists crm_messages_inbound_consent on public.crm_messages;
create trigger crm_messages_inbound_consent
  after insert on public.crm_messages
  for each row
  when (new.direction = 'inbound' and new.channel in ('whatsapp', 'sms'))
  execute function private.crm_consent_from_inbound_message();
