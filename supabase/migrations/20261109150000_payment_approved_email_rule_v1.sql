-- Regra "Pagamento aprovado": e-mail (ou WhatsApp) automático para o comprador quando o pagamento é aprovado.
--
-- Reaproveita o pipeline das regras de remarketing com um prefixo próprio, 'paid:<rule_id>':
--   trigger de pagamento aprovado -> recovery_events 'paid:<rule>' (next_attempt_at = agora + delay da regra)
--     -> checkout-recovery-worker -> outbox (metadata.source = 'payment_approved') -> dispatcher.
-- Todas as travas de "checkout já pago" do remarketing passam a ignorar esse prefixo/source.

-- 1. Novo gatilho na tabela e no save.
alter table public.crm_remarketing_rules drop constraint if exists crm_remarketing_rules_trigger_event_check;
alter table public.crm_remarketing_rules add constraint crm_remarketing_rules_trigger_event_check
  check (trigger_event in ('payment_pending', 'checkout_abandoned', 'payment_approved'));

create or replace function public.crm_remarketing_rule_save(
  p_id uuid, p_trigger_event text, p_channel text, p_channel_account_id uuid, p_delay_minutes integer, p_body text,
  p_email_subject text default null, p_button_text text default null, p_button_url text default null,
  p_funnel_id text default null, p_active boolean default true)
returns public.crm_remarketing_rules
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_remarketing_rules;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_subject text := nullif(btrim(coalesce(p_email_subject, '')), '');
  v_button text := nullif(btrim(coalesce(p_button_text, '')), '');
  v_url text := nullif(btrim(coalesce(p_button_url, '')), '');
  v_funnel text := nullif(btrim(coalesce(p_funnel_id, '')), '');
begin
  select * into c from private.crm_config_context('can_manage_automations');
  if p_trigger_event not in ('payment_pending', 'checkout_abandoned', 'payment_approved') or p_channel not in ('email', 'whatsapp') then
    raise exception 'REMARKETING_RULE_INVALID' using errcode = '22023';
  end if;
  if p_delay_minutes is null or p_delay_minutes not between 1 and 10080 then
    raise exception 'REMARKETING_DELAY_INVALID' using errcode = '22023';
  end if;
  if v_body is null or length(v_body) > 4000 then raise exception 'REMARKETING_BODY_INVALID' using errcode = '22023'; end if;
  if p_channel = 'email' and v_subject is null then raise exception 'REMARKETING_SUBJECT_REQUIRED' using errcode = '22023'; end if;
  if v_button is not null and v_url is null then v_url := '{link}'; end if;
  if v_url is not null and v_url <> '{link}' and v_url !~* '^https://[^\s<>"]+$' then
    raise exception 'REMARKETING_BUTTON_URL_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crm_channel_accounts a
                  where a.id = p_channel_account_id and a.organization_id = c.organization_id and a.channel = p_channel) then
    raise exception 'REMARKETING_ACCOUNT_INVALID' using errcode = '22023';
  end if;
  if v_funnel is not null and not exists (select 1 from public.funnels f
                  where f.id = v_funnel and f.organization_id = c.organization_id and f.deleted_at is null) then
    raise exception 'FUNNEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.crm_remarketing_rules (organization_id, funnel_id, trigger_event, channel, channel_account_id, delay_minutes,
      email_subject, body, button_text, button_url, active)
    values (c.organization_id, v_funnel, p_trigger_event, p_channel, p_channel_account_id, p_delay_minutes,
      case when p_channel = 'email' then v_subject end, v_body, v_button, v_url, coalesce(p_active, true))
    returning * into v;
  else
    update public.crm_remarketing_rules
       set funnel_id = v_funnel, trigger_event = p_trigger_event, channel = p_channel, channel_account_id = p_channel_account_id,
           delay_minutes = p_delay_minutes, email_subject = case when p_channel = 'email' then v_subject end, body = v_body,
           button_text = v_button, button_url = v_url, active = coalesce(p_active, true), updated_at = now()
     where id = p_id and organization_id = c.organization_id
    returning * into v;
    if not found then raise exception 'REMARKETING_RULE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.remarketing_rule.saved', 'crm_remarketing_rule', v.id::text,
          jsonb_build_object('trigger_event', v.trigger_event, 'channel', v.channel, 'delay_minutes', v.delay_minutes, 'active', v.active));
  return v;
end;
$function$;

-- 2. Pagamento aprovado: além de concluir o checkout e cancelar o remarketing, enfileira as regras 'payment_approved'.
--    Só pagamentos de checkout (metadata.checkout_session_id) têm comprador com e-mail para receber.
create or replace function private.checkout_on_payment_approved()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_checkout uuid;
begin
  if new.status is distinct from 'approved' or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;
  if coalesce(new.metadata->>'checkout_session_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_checkout := (new.metadata->>'checkout_session_id')::uuid;

  update public.checkout_sessions
     set status = 'completed', completed_at = coalesce(completed_at, now()), abandoned_at = null, updated_at = now()
   where id = v_checkout and organization_id = new.organization_id and status is distinct from 'completed';

  -- 'processing' já está saindo; o dispatcher confere o pagamento antes de entregar.
  update public.crm_channel_message_outbox
     set status = 'cancelled', last_error = 'checkout_paid', updated_at = now()
   where metadata->>'recovery_checkout_id' = v_checkout::text and status = 'queued'
     and coalesce(metadata->>'source', '') <> 'payment_approved';

  update public.recovery_events
     set status = 'cancelled_paid', processed_at = now(), updated_at = now()
   where checkout_id = v_checkout and status in ('queued', 'processing') and event_type not like 'paid:%';

  -- Uma linha por regra e checkout: um segundo "approved" do mesmo checkout não manda de novo.
  insert into public.recovery_events (user_id, organization_id, checkout_id, event_type, status, payload, rule_id, next_attempt_at, updated_at)
  select cs.user_id, cs.organization_id, cs.id, 'paid:' || r.id, 'queued',
         jsonb_build_object('checkout_id', cs.id, 'rule_id', r.id, 'transaction_id', new.id, 'source', 'payment_approved'),
         r.id, now() + make_interval(mins => r.delay_minutes), now()
    from public.checkout_sessions cs
    join public.crm_remarketing_rules r
      on r.organization_id = cs.organization_id and r.active and r.trigger_event = 'payment_approved'
     and (r.funnel_id is null or r.funnel_id = cs.funnel_id)
   where cs.id = v_checkout and cs.organization_id = new.organization_id
  on conflict (checkout_id, event_type) do nothing;
  return new;
end;
$function$;
revoke all on function private.checkout_on_payment_approved() from public, anon, authenticated;

-- 3. Claim: 'paid:*' é servido mesmo com o checkout pago (é justamente o caso dele).
drop function if exists public.claim_checkout_recovery_events_v1(integer);
create function public.claim_checkout_recovery_events_v1(p_limit integer default 25)
returns table(event_id uuid, user_id uuid, organization_id uuid, checkout_id uuid, funnel_id text, funnel_url text, product_id text,
              amount numeric, currency text, customer jsonb, checkout_metadata jsonb, recovery_count integer, event_attempt_count integer,
              event_type text, rule_id uuid)
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
     where r.status = 'queued'
       and (r.next_attempt_at is null or r.next_attempt_at <= now())
       and (
             r.event_type like 'paid:%'
             or ((r.event_type in ('recovery_due', 'payment_pending') or r.event_type like 'rule:%' or r.event_type like 'manual:%')
                 and c.completed_at is null
                 and (r.event_type <> 'recovery_due' or (c.status = 'abandoned' and c.recovery_count < 5))
                 and not exists (
                       select 1 from public.gateway_transactions a
                        where a.organization_id = c.organization_id
                          and a.metadata ? 'checkout_session_id'
                          and a.metadata->>'checkout_session_id' = c.id::text
                          and a.status = 'approved'))
           )
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
     where c.id in (select cl.checkout_id from claimed cl where cl.event_type = 'recovery_due')
    returning c.id
  )
  select cl.id, cl.user_id, coalesce(cl.organization_id, cs.organization_id), cs.id, cs.funnel_id, f.url,
         cs.product_id, cs.amount, cs.currency, cs.customer, cs.metadata, cs.recovery_count, cl.attempt_count, cl.event_type, cl.rule_id
    from claimed cl
    join public.checkout_sessions cs on cs.id = cl.checkout_id
    left join public.funnels f on f.id = cs.funnel_id and f.organization_id = cs.organization_id;
end;
$function$;
revoke all on function public.claim_checkout_recovery_events_v1(integer) from public, anon, authenticated;
grant execute on function public.claim_checkout_recovery_events_v1(integer) to service_role;

-- 4. Botão manual de remarketing não pode pegar o texto de "obrigado pela compra".
create or replace function public.checkout_remarketing_send_v1(p_checkout_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_cs public.checkout_sessions%rowtype;
  v_rule uuid;
  n integer;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not private.has_org_capability(v_org, 'can_reply_chats') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_channel not in ('email', 'whatsapp') then raise exception 'INVALID_CHANNEL' using errcode = '22023'; end if;
  select * into v_cs from public.checkout_sessions where id = p_checkout_id and organization_id = v_org;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_cs.completed_at is not null or exists (select 1 from public.gateway_transactions a
       where a.organization_id = v_org and a.metadata ? 'checkout_session_id'
         and a.metadata->>'checkout_session_id' = p_checkout_id::text and a.status = 'approved') then
    raise exception 'CHECKOUT_ALREADY_PAID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crm_channel_accounts a where a.organization_id = v_org and a.channel = p_channel and a.status = 'active') then
    raise exception 'CHANNEL_ACCOUNT_MISSING' using errcode = 'P0002';
  end if;

  -- Usa o texto da regra ativa do canal (a do funil ganha da geral); sem regra, o worker usa o template/texto padrão.
  select r.id into v_rule from public.crm_remarketing_rules r
   where r.organization_id = v_org and r.channel = p_channel and r.active and r.trigger_event <> 'payment_approved'
     and (r.funnel_id is null or r.funnel_id = v_cs.funnel_id)
   order by (r.funnel_id is not null) desc,
            (r.trigger_event = case when v_cs.status = 'abandoned' then 'checkout_abandoned' else 'payment_pending' end) desc,
            r.created_at
   limit 1;

  insert into public.recovery_events (user_id, organization_id, checkout_id, event_type, status, payload, rule_id, next_attempt_at, updated_at)
  values (v_cs.user_id, v_org, v_cs.id, 'manual:' || p_channel || ':' || floor(extract(epoch from now()) / 600)::bigint, 'queued',
          jsonb_build_object('checkout_id', v_cs.id, 'source', 'manual_remarketing', 'requested_by', auth.uid()), v_rule, now(), now())
  on conflict (checkout_id, event_type) do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'REMARKETING_RECENTLY_SENT' using errcode = '22023'; end if;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (v_cs.user_id, auth.uid(), v_org, 'checkout.remarketing.requested', 'checkout_session', v_cs.id::text,
          jsonb_build_object('channel', p_channel, 'rule_id', v_rule));
  return jsonb_build_object('queued', true, 'rule_id', v_rule);
end;
$function$;
revoke all on function public.checkout_remarketing_send_v1(uuid, text) from public, anon;
grant execute on function public.checkout_remarketing_send_v1(uuid, text) to authenticated;
