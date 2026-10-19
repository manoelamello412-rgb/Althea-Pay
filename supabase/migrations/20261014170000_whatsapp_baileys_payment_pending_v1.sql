-- WhatsApp gets a provider choice per organization (Baileys bridge or Infobip) on a single account,
-- and its only automatic message is the "payment still pending" nudge: one per checkout, 5 minutes
-- after the payment was created.

-- Baileys sends free text, so an approved template name is only needed when the provider is Infobip.
alter table public.crm_message_templates drop constraint if exists crm_message_templates_check;
alter table public.crm_message_templates drop constraint if exists crm_message_templates_trigger_event_check;
alter table public.crm_message_templates add constraint crm_message_templates_trigger_event_check
  check (trigger_event in ('checkout_abandoned', 'payment_pending'));

create or replace function public.enqueue_payment_pending_events(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  n integer;
begin
  -- recovery_events_checkout_type_unique (checkout_id, event_type) keeps it to one nudge per checkout.
  insert into public.recovery_events (user_id, organization_id, checkout_id, event_type, status, payload)
  select distinct on (cs.id) cs.user_id, cs.organization_id, cs.id, 'payment_pending', 'queued',
         jsonb_build_object('checkout_id', cs.id, 'transaction_id', t.id)
    from public.gateway_transactions t
    join public.checkout_sessions cs
      on cs.organization_id = t.organization_id and cs.id::text = t.metadata->>'checkout_session_id'
   where t.status = 'pending'
     and t.created_at <= now() - interval '5 minutes'
     and t.created_at > now() - interval '24 hours'
     and cs.completed_at is null
     and not exists (select 1 from public.gateway_transactions a
                      where a.organization_id = cs.organization_id
                        and a.metadata->>'checkout_session_id' = cs.id::text
                        and a.status = 'approved')
   order by cs.id, t.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 1000))
  on conflict (checkout_id, event_type) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Same claim as v30, now also serving payment_pending (checkout still open, not abandoned yet)
-- and returning event_type so the worker can pick channel and text.
drop function if exists public.claim_checkout_recovery_events_v1(integer);
create function public.claim_checkout_recovery_events_v1(p_limit integer default 25)
returns table(event_id uuid, user_id uuid, organization_id uuid, checkout_id uuid, funnel_id text, funnel_url text, product_id text, amount numeric, currency text, customer jsonb, checkout_metadata jsonb, recovery_count integer, event_attempt_count integer, event_type text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  return query
  with candidates as (
    select r.id
      from public.recovery_events r
      join public.checkout_sessions c on c.id = r.checkout_id
     where r.event_type in ('recovery_due', 'payment_pending')
       and r.status = 'queued'
       and (r.next_attempt_at is null or r.next_attempt_at <= now())
       and c.completed_at is null
       and c.recovery_count < 5
       and (r.event_type = 'payment_pending' or c.status = 'abandoned')
       and (r.event_type <> 'payment_pending' or not exists (
             select 1 from public.gateway_transactions a
              where a.organization_id = c.organization_id
                and a.metadata->>'checkout_session_id' = c.id::text
                and a.status = 'approved'))
     order by r.created_at asc
     for update of r skip locked
     limit v_limit
  ),
  claimed as (
    update public.recovery_events r
       set status = 'processing', attempt_count = r.attempt_count + 1, updated_at = now(), last_error = null
      from candidates c
     where r.id = c.id
    returning r.*
  ),
  checkout_update as (
    update public.checkout_sessions c
       set recovery_status = 'processing', updated_at = now()
     where c.id in (select cl.checkout_id from claimed cl where cl.event_type <> 'payment_pending')
    returning c.id
  )
  select cl.id, cl.user_id, coalesce(cl.organization_id, cs.organization_id), cs.id, cs.funnel_id, f.url,
         cs.product_id, cs.amount, cs.currency, cs.customer, cs.metadata, cs.recovery_count, cl.attempt_count, cl.event_type
    from claimed cl
    join public.checkout_sessions cs on cs.id = cl.checkout_id
    left join public.funnels f on f.id = cs.funnel_id and f.organization_id = cs.organization_id;
end;
$function$;


-- The pending-payment nudge must not consume the checkout's abandoned-cart recovery state
-- (recovery_status/recovery_count), or orgs without WhatsApp would lose e-mail recovery.
CREATE OR REPLACE FUNCTION public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text DEFAULT NULL::text, p_conversation_id uuid DEFAULT NULL::uuid, p_outbox_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text, p_retry_seconds integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_event public.recovery_events%rowtype;
  v_status text:=lower(btrim(coalesce(p_status,'')));
  v_retry integer:=greatest(30,least(coalesce(p_retry_seconds,300),86400));
begin
  if v_status not in ('outbox_queued','blocked_consent','blocked_no_channel','blocked_no_destination','retry','dead_letter') then
    raise exception 'invalid_recovery_worker_status';
  end if;

  select * into v_event from public.recovery_events where id=p_event_id for update;
  if not found then raise exception 'recovery_event_not_found'; end if;

  if v_status='outbox_queued' then
    update public.recovery_events
    set status='outbox_queued',
        channel=nullif(btrim(coalesce(p_channel,'')),''),
        conversation_id=p_conversation_id,
        outbox_id=p_outbox_id,
        next_attempt_at=null,
        last_error=null,
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status='queued_delivery',
        recovery_count=recovery_count+1,
        recovery_next_at=null,
        updated_at=now()
    where id=v_event.checkout_id
      and v_event.event_type<>'payment_pending';

  elsif v_status='retry' then
    update public.recovery_events
    set status='queued',
        next_attempt_at=now()+make_interval(secs=>v_retry),
        last_error=left(coalesce(p_error,'recovery_worker_retry'),2000),
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status='queued',
        recovery_next_at=now()+make_interval(secs=>v_retry),
        updated_at=now()
    where id=v_event.checkout_id
      and v_event.event_type<>'payment_pending';

  else
    update public.recovery_events
    set status=v_status,
        channel=nullif(btrim(coalesce(p_channel,'')),''),
        conversation_id=p_conversation_id,
        outbox_id=p_outbox_id,
        processed_at=now(),
        next_attempt_at=case when v_status='blocked_no_channel' then now()+interval '1 hour' else null end,
        last_error=left(coalesce(p_error,v_status),2000),
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status=v_status,
        recovery_next_at=case when v_status='blocked_no_channel' then now()+interval '1 hour' else null end,
        updated_at=now()
    where id=v_event.checkout_id
      and v_event.event_type<>'payment_pending';
  end if;

  return jsonb_build_object(
    'event_id',p_event_id,
    'checkout_id',v_event.checkout_id,
    'status',v_status,
    'outbox_id',p_outbox_id
  );
end;
$function$;

revoke all on function public.enqueue_payment_pending_events(integer) from public, anon, authenticated;
revoke all on function public.claim_checkout_recovery_events_v1(integer) from public, anon, authenticated;
grant execute on function public.enqueue_payment_pending_events(integer) to service_role;
grant execute on function public.claim_checkout_recovery_events_v1(integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'althea-payment-pending-enqueue') then
    perform cron.unschedule('althea-payment-pending-enqueue');
  end if;
end
$$;
select cron.schedule('althea-payment-pending-enqueue', '* * * * *', 'select public.enqueue_payment_pending_events(100);');

-- One WhatsApp account per organization: switching provider keeps its id, so support
-- conversations (crm_conversations.channel_account_id) keep replying through the same number.
-- Fails loudly if an organization already has two WhatsApp accounts; merge them first.
drop function if exists public.crm_whatsapp_account_ensure();
drop index if exists public.crm_channel_accounts_one_baileys_per_org;
create unique index if not exists crm_channel_accounts_one_whatsapp_per_org
  on public.crm_channel_accounts (organization_id) where channel = 'whatsapp';

create or replace function private.crm_whatsapp_secret(p_secret_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, vault
as $function$
  select coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where id = p_secret_id), '{}'::jsonb);
$function$;
revoke all on function private.crm_whatsapp_secret(uuid) from public, anon, authenticated;

create or replace function public.crm_whatsapp_settings()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  a public.crm_channel_accounts;
  v_secret jsonb;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  select * into a from public.crm_channel_accounts where organization_id = c.organization_id and channel = 'whatsapp';
  if not found then return null; end if;
  v_secret := private.crm_whatsapp_secret(nullif(a.metadata->>'vault_secret_id', '')::uuid);
  return jsonb_build_object(
    'id', a.id, 'provider', a.provider, 'status', a.status,
    'base_url', a.metadata->>'base_url', 'from_number', a.metadata->>'from_number',
    'has_api_key', coalesce(v_secret->>'api_key', '') <> '' or a.credentials_ref is not null,
    'webhook_token', v_secret->>'webhook_token');
end;
$function$;

create or replace function public.crm_whatsapp_configure(p_provider text, p_base_url text default null, p_from_number text default null, p_api_key text default null)
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
  v_secret_id uuid;
  v_secret jsonb;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if p_provider not in ('baileys', 'infobip') then raise exception 'WHATSAPP_PROVIDER_INVALID' using errcode = '22023'; end if;

  insert into public.crm_channel_accounts (user_id, organization_id, channel, provider, display_name, status)
  values (c.owner_id, c.organization_id, 'whatsapp', p_provider, 'WhatsApp', 'active')
  on conflict (organization_id) where channel = 'whatsapp' do nothing;
  select * into a from public.crm_channel_accounts where organization_id = c.organization_id and channel = 'whatsapp' for update;

  if p_provider = 'infobip' then
    -- Only Infobip API hosts: the API key is sent to this URL.
    if v_base !~ '^[a-z0-9-]+\.api\.infobip\.com$' then raise exception 'INFOBIP_BASE_URL_INVALID' using errcode = '22023'; end if;
    if length(v_from) in (10, 11) then v_from := '55' || v_from; end if; -- bare Brazilian number
    if length(v_from) not between 12 and 15 then raise exception 'WHATSAPP_NUMBER_INVALID' using errcode = '22023'; end if;
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
       set provider = 'infobip', status = 'active', external_account_id = v_from, updated_at = now(),
           metadata = metadata || jsonb_build_object('base_url', 'https://' || v_base, 'from_number', v_from, 'vault_secret_id', v_secret_id)
     where id = a.id;
  else
    update public.crm_channel_accounts set provider = 'baileys', status = 'active', updated_at = now() where id = a.id;
  end if;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.whatsapp.configured', 'crm_channel_account', a.id::text, jsonb_build_object('provider', p_provider));
  return public.crm_whatsapp_settings();
end;
$function$;

-- Server-side credential lookup for the dispatcher and the Infobip webhook.
create or replace function public.crm_channel_account_credentials(p_account_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  select private.crm_whatsapp_secret(nullif(metadata->>'vault_secret_id', '')::uuid)
    from public.crm_channel_accounts where id = p_account_id;
$function$;

revoke all on function public.crm_whatsapp_settings() from public, anon;
revoke all on function public.crm_whatsapp_configure(text, text, text, text) from public, anon;
revoke all on function public.crm_channel_account_credentials(uuid) from public, anon, authenticated;
grant execute on function public.crm_whatsapp_settings() to authenticated;
grant execute on function public.crm_whatsapp_configure(text, text, text, text) to authenticated;
grant execute on function public.crm_channel_account_credentials(uuid) to service_role;
