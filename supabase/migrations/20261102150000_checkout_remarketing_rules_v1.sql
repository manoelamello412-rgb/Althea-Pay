-- Fase 2: checkouts (filtro por data, comprovante manual, status automático) e remarketing configurável.
--
-- Fluxo do remarketing:
--   crm_remarketing_rules (por org, opcionalmente por funil)
--     -> enqueue_remarketing_rule_events() a cada 2 min cria recovery_events 'rule:<id>' (um por regra e checkout)
--     -> checkout-recovery-worker monta conversa/identidade e enfileira no outbox com o texto da regra
--     -> crm-channel-outbox-dispatcher envia (e confere de novo se o checkout já foi pago)
--   Pagamento aprovado -> trigger cancela outbox/recovery_events pendentes e conclui o checkout.
--   O botão manual da tela de checkouts cria um recovery_event 'manual:<canal>:<janela de 10 min>'.

-- 1. Outbox ganha o status 'cancelled' (remarketing cancelado porque o checkout foi pago).
alter table public.crm_channel_message_outbox drop constraint if exists crm_channel_message_outbox_status_check;
alter table public.crm_channel_message_outbox add constraint crm_channel_message_outbox_status_check
  check (status in ('queued','processing','sent','failed','dead_letter','cancelled'));

create index if not exists crm_outbox_recovery_checkout_idx
  on public.crm_channel_message_outbox ((metadata->>'recovery_checkout_id'))
  where status in ('queued','processing');

create index if not exists checkout_sessions_abandoned_org_idx
  on public.checkout_sessions (organization_id, abandoned_at)
  where status = 'abandoned' and completed_at is null;

-- 2. Pagamento aprovado: conclui o checkout (fim do "lifecycle drift") e cancela o remarketing na fila.
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
   where metadata->>'recovery_checkout_id' = v_checkout::text and status = 'queued';

  update public.recovery_events
     set status = 'cancelled_paid', processed_at = now(), updated_at = now()
   where checkout_id = v_checkout and status in ('queued', 'processing');
  return new;
end;
$function$;
revoke all on function private.checkout_on_payment_approved() from public, anon, authenticated;

drop trigger if exists trg_checkout_on_payment_approved on public.gateway_transactions;
create trigger trg_checkout_on_payment_approved
after insert or update of status on public.gateway_transactions
for each row execute function private.checkout_on_payment_approved();

-- Corrige de uma vez os checkouts que já estavam pagos mas não concluídos.
update public.checkout_sessions c
   set status = 'completed', completed_at = coalesce(c.completed_at, t.created_at), abandoned_at = null, updated_at = now()
  from public.gateway_transactions t
 where t.status = 'approved'
   and t.metadata ? 'checkout_session_id'
   and t.metadata->>'checkout_session_id' = c.id::text
   and t.organization_id = c.organization_id
   and c.status is distinct from 'completed';

-- 3. Regras de remarketing.
create table if not exists public.crm_remarketing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id text references public.funnels(id) on delete cascade,
  trigger_event text not null check (trigger_event in ('payment_pending', 'checkout_abandoned')),
  channel text not null check (channel in ('email', 'whatsapp')),
  channel_account_id uuid not null references public.crm_channel_accounts(id) on delete cascade,
  delay_minutes integer not null check (delay_minutes between 1 and 10080),
  email_subject text check (email_subject is null or length(email_subject) between 1 and 200),
  body text not null check (length(body) between 1 and 4000),
  button_text text check (button_text is null or length(button_text) between 1 and 60),
  button_url text check (button_url is null or length(button_url) between 1 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_remarketing_rules_org_active_idx on public.crm_remarketing_rules (organization_id, trigger_event) where active;
alter table public.crm_remarketing_rules enable row level security;
drop policy if exists crm_remarketing_rules_member_read on public.crm_remarketing_rules;
create policy crm_remarketing_rules_member_read on public.crm_remarketing_rules
  for select to authenticated using (private.is_org_member(organization_id));
revoke insert, update, delete on public.crm_remarketing_rules from anon, authenticated;

alter table public.recovery_events
  add column if not exists rule_id uuid references public.crm_remarketing_rules(id) on delete cascade;
create index if not exists recovery_events_rule_idx on public.recovery_events (rule_id) where rule_id is not null;

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
  if p_trigger_event not in ('payment_pending', 'checkout_abandoned') or p_channel not in ('email', 'whatsapp') then
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

create or replace function public.crm_remarketing_rule_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  delete from public.crm_remarketing_rules where id = p_id and organization_id = c.organization_id;
  if not found then raise exception 'REMARKETING_RULE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.remarketing_rule.deleted', 'crm_remarketing_rule', p_id::text, '{}'::jsonb);
end;
$function$;

revoke all on function public.crm_remarketing_rule_save(uuid, text, text, uuid, integer, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.crm_remarketing_rule_delete(uuid) from public, anon;
grant execute on function public.crm_remarketing_rule_save(uuid, text, text, uuid, integer, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.crm_remarketing_rule_delete(uuid) to authenticated;

-- 4. Fila: uma linha por regra e checkout, depois do tempo configurado (janela de 24h para não pegar histórico antigo).
create or replace function public.enqueue_remarketing_rule_events(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  n integer;
begin
  insert into public.recovery_events (user_id, organization_id, checkout_id, event_type, status, payload, rule_id, next_attempt_at, updated_at)
  select x.user_id, x.organization_id, x.checkout_id, 'rule:' || x.rule_id, 'queued',
         jsonb_build_object('checkout_id', x.checkout_id, 'rule_id', x.rule_id, 'source', 'remarketing_rule'), x.rule_id, now(), now()
    from (
      select distinct on (cs.id, r.id) cs.user_id, cs.organization_id, cs.id as checkout_id, r.id as rule_id
        from public.crm_remarketing_rules r
        join public.gateway_transactions t
          on t.organization_id = r.organization_id and t.status = 'pending' and t.metadata ? 'checkout_session_id'
         and t.metadata->>'checkout_session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and t.created_at <= now() - make_interval(mins => r.delay_minutes)
         and t.created_at > now() - make_interval(mins => r.delay_minutes) - interval '24 hours'
        join public.checkout_sessions cs
          on cs.id = (t.metadata->>'checkout_session_id')::uuid and cs.organization_id = t.organization_id
       where r.active and r.trigger_event = 'payment_pending'
         and cs.completed_at is null
         and (r.funnel_id is null or cs.funnel_id = r.funnel_id)
      union all
      select cs.user_id, cs.organization_id, cs.id, r.id
        from public.crm_remarketing_rules r
        join public.checkout_sessions cs
          on cs.organization_id = r.organization_id and cs.status = 'abandoned' and cs.completed_at is null
         and cs.abandoned_at <= now() - make_interval(mins => r.delay_minutes)
         and cs.abandoned_at > now() - make_interval(mins => r.delay_minutes) - interval '24 hours'
       where r.active and r.trigger_event = 'checkout_abandoned'
         and (r.funnel_id is null or cs.funnel_id = r.funnel_id)
    ) x
   where not exists (select 1 from public.gateway_transactions a
                      where a.organization_id = x.organization_id and a.metadata ? 'checkout_session_id'
                        and a.metadata->>'checkout_session_id' = x.checkout_id::text and a.status = 'approved')
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
  on conflict (checkout_id, event_type) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function public.enqueue_remarketing_rule_events(integer) from public, anon, authenticated;
grant execute on function public.enqueue_remarketing_rule_events(integer) to service_role;

-- O aviso fixo de 5 minutos só vale para quem ainda não configurou regra de pagamento pendente.
create or replace function public.enqueue_payment_pending_events(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  n integer;
begin
  insert into public.recovery_events (user_id, organization_id, checkout_id, event_type, status, payload)
  select distinct on (cs.id) cs.user_id, cs.organization_id, cs.id, 'payment_pending', 'queued',
         jsonb_build_object('checkout_id', cs.id, 'transaction_id', t.id)
    from public.gateway_transactions t
    join public.checkout_sessions cs
      on cs.id = (t.metadata->>'checkout_session_id')::uuid
     and cs.organization_id = t.organization_id
   where t.status = 'pending'
     and t.metadata->>'checkout_session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and t.created_at <= now() - interval '5 minutes'
     and t.created_at > now() - interval '24 hours'
     and cs.completed_at is null
     and not exists (select 1 from public.crm_remarketing_rules rr
                      where rr.organization_id = t.organization_id and rr.active and rr.trigger_event = 'payment_pending')
     and not exists (select 1 from public.gateway_transactions a
                      where a.organization_id = t.organization_id
                        and a.metadata ? 'checkout_session_id'
                        and a.metadata->>'checkout_session_id' = t.metadata->>'checkout_session_id'
                        and a.status = 'approved')
   order by cs.id, t.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 1000))
  on conflict (checkout_id, event_type) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function public.enqueue_payment_pending_events(integer) from public, anon, authenticated;
grant execute on function public.enqueue_payment_pending_events(integer) to service_role;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'althea-remarketing-rules-enqueue';
  perform cron.schedule('althea-remarketing-rules-enqueue', '*/2 * * * *', 'select public.enqueue_remarketing_rule_events(200);');
end $$;

-- 5. Claim: serve também 'rule:*' e 'manual:*' e devolve rule_id. Só 'recovery_due' mexe no estado de recuperação do checkout.
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
     where (r.event_type in ('recovery_due', 'payment_pending') or r.event_type like 'rule:%' or r.event_type like 'manual:%')
       and r.status = 'queued'
       and (r.next_attempt_at is null or r.next_attempt_at <= now())
       and c.completed_at is null
       and (r.event_type <> 'recovery_due' or (c.status = 'abandoned' and c.recovery_count < 5))
       and not exists (
             select 1 from public.gateway_transactions a
              where a.organization_id = c.organization_id
                and a.metadata ? 'checkout_session_id'
                and a.metadata->>'checkout_session_id' = c.id::text
                and a.status = 'approved')
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

-- 'superseded': o evento antigo foi substituído por uma regra configurada.
create or replace function public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text default null,
  p_conversation_id uuid default null, p_outbox_id uuid default null, p_error text default null, p_retry_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_event public.recovery_events%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_retry integer := greatest(30, least(coalesce(p_retry_seconds, 300), 86400));
  v_cart boolean;
begin
  if v_status not in ('outbox_queued','blocked_consent','blocked_no_channel','blocked_no_destination','retry','dead_letter','superseded') then
    raise exception 'invalid_recovery_worker_status';
  end if;

  select * into v_event from public.recovery_events where id = p_event_id for update;
  if not found then raise exception 'recovery_event_not_found'; end if;
  v_cart := v_event.event_type = 'recovery_due';

  if v_status = 'outbox_queued' then
    update public.recovery_events
       set status = 'outbox_queued', channel = nullif(btrim(coalesce(p_channel, '')), ''), conversation_id = p_conversation_id,
           outbox_id = p_outbox_id, next_attempt_at = null, last_error = null, updated_at = now()
     where id = p_event_id;
    update public.checkout_sessions
       set recovery_status = 'queued_delivery', recovery_count = recovery_count + 1, recovery_next_at = null, updated_at = now()
     where id = v_event.checkout_id and v_cart;
  elsif v_status = 'retry' then
    update public.recovery_events
       set status = 'queued', next_attempt_at = now() + make_interval(secs => v_retry),
           last_error = left(coalesce(p_error, 'recovery_worker_retry'), 2000), updated_at = now()
     where id = p_event_id;
    update public.checkout_sessions
       set recovery_status = 'queued', recovery_next_at = now() + make_interval(secs => v_retry), updated_at = now()
     where id = v_event.checkout_id and v_cart;
  else
    update public.recovery_events
       set status = v_status, channel = nullif(btrim(coalesce(p_channel, '')), ''), conversation_id = p_conversation_id,
           outbox_id = p_outbox_id, processed_at = now(),
           next_attempt_at = case when v_status = 'blocked_no_channel' then now() + interval '1 hour' else null end,
           last_error = left(coalesce(p_error, v_status), 2000), updated_at = now()
     where id = p_event_id;
    update public.checkout_sessions
       set recovery_status = v_status,
           recovery_next_at = case when v_status = 'blocked_no_channel' then now() + interval '1 hour' else null end,
           updated_at = now()
     where id = v_event.checkout_id and v_cart;
  end if;

  return jsonb_build_object('event_id', p_event_id, 'checkout_id', v_event.checkout_id, 'status', v_status, 'outbox_id', p_outbox_id);
end;
$function$;
revoke all on function public.update_checkout_recovery_worker_v1(uuid, text, text, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.update_checkout_recovery_worker_v1(uuid, text, text, uuid, uuid, text, integer) to service_role;

-- 6. Botões "Remarketing por e-mail/WhatsApp" da tela de checkouts. Um disparo por canal a cada 10 minutos.
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
   where r.organization_id = v_org and r.channel = p_channel and r.active and (r.funnel_id is null or r.funnel_id = v_cs.funnel_id)
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

-- 7. Comprovante anexado manualmente no checkout. Arquivo em chat-attachments/<org>/checkouts/<checkout>/...
--    (a policy de leitura do bucket já exige can_view_chats + can_view_values pela pasta da org).
create table if not exists public.checkout_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checkout_id uuid not null references public.checkout_sessions(id) on delete cascade,
  transaction_id uuid references public.gateway_transactions(id) on delete set null,
  bucket text not null default 'chat-attachments',
  path text not null unique,
  file_name text,
  mime_type text not null,
  size_bytes integer not null,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists checkout_receipts_checkout_idx on public.checkout_receipts (checkout_id, created_at desc);
alter table public.checkout_receipts enable row level security;
drop policy if exists checkout_receipts_read on public.checkout_receipts;
create policy checkout_receipts_read on public.checkout_receipts for select to authenticated
  using (private.has_org_capability(organization_id, 'can_view_chats') and private.has_org_capability(organization_id, 'can_view_values'));
revoke insert, update, delete on public.checkout_receipts from anon, authenticated;

drop policy if exists chat_attachments_checkout_receipt_insert on storage.objects;
create policy chat_attachments_checkout_receipt_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[2] = 'checkouts'
    and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_reply_chats')
    and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_view_values')
  );

create or replace function public.checkout_receipt_attach_v1(p_checkout_id uuid, p_path text, p_mime_type text, p_size_bytes integer, p_file_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_tx uuid;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not (private.has_org_capability(v_org, 'can_reply_chats') and private.has_org_capability(v_org, 'can_view_values')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.checkout_sessions where id = p_checkout_id and organization_id = v_org) then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'INVALID_FILE_TYPE' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 4194304 then raise exception 'INVALID_FILE_SIZE' using errcode = '22023'; end if;
  if p_path is null or p_path like '%..%' or p_path not like v_org::text || '/checkouts/' || p_checkout_id::text || '/%' then
    raise exception 'INVALID_ATTACHMENT_PATH' using errcode = '22023';
  end if;

  select t.id into v_tx from public.gateway_transactions t
   where t.organization_id = v_org and t.metadata ? 'checkout_session_id' and t.metadata->>'checkout_session_id' = p_checkout_id::text
   order by t.created_at desc limit 1;

  insert into public.checkout_receipts (organization_id, checkout_id, transaction_id, path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_org, p_checkout_id, v_tx, p_path, left(nullif(btrim(p_file_name), ''), 200), p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'checkout.receipt.attached', 'checkout_session', p_checkout_id::text,
          jsonb_build_object('receipt_id', v_id, 'transaction_id', v_tx));
  return jsonb_build_object('id', v_id, 'transaction_id', v_tx);
end;
$function$;
revoke all on function public.checkout_receipt_attach_v1(uuid, text, text, integer, text) from public, anon;
grant execute on function public.checkout_receipt_attach_v1(uuid, text, text, integer, text) to authenticated;

-- 8. Lista de checkouts: filtro por período (p_from inclusivo, p_to exclusivo).
drop function if exists public.checkout_operations_page_v1(integer, timestamptz, uuid, text, text, text);
create or replace function public.checkout_operations_page_v1(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_status text default null,
  p_query text default null,
  p_funnel_id text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_items jsonb := '[]'::jsonb;
  v_metrics jsonb := '{}'::jsonb;
  v_has_more boolean := false;
  v_next_created timestamptz;
  v_next_id uuid;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id = v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode = '42501', message = 'organization_required';
  end if;
  if v_query is not null and length(v_query) > 120 then raise exception using errcode = '22001', message = 'search_too_long'; end if;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where lower(c.status) in ('started', 'pending', 'processing')),
    'completed', count(*) filter (where lower(c.status) = 'completed'),
    'abandoned', count(*) filter (where lower(c.status) = 'abandoned'),
    'failed', count(*) filter (where lower(c.status) = 'failed'),
    'amount', coalesce(sum(c.amount), 0)
  )
  into v_metrics
  from public.checkout_sessions c
  left join public.funnels f on f.id = c.funnel_id and f.organization_id = c.organization_id
  left join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
  where c.organization_id = v_org
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at < p_to)
    and (p_funnel_id is null or p_funnel_id = '' or c.funnel_id = p_funnel_id)
    and (v_query is null or lower(concat_ws(' ', c.id::text, c.customer->>'name', c.customer->>'full_name', c.customer->>'email',
          c.customer->>'phone', f.nome, p.name, c.attribution->>'source', c.attribution->>'campaign')) like '%' || v_query || '%');

  with candidates as (
    select
      c.id, c.funnel_id, c.product_id, c.status, c.currency, c.amount, c.customer, c.attribution, c.metadata,
      c.created_at, c.updated_at, c.abandoned_at, c.completed_at, c.recovery_count, c.recovery_status,
      f.nome as funnel_name,
      p.name as product_name,
      tx.id as transaction_id,
      tx.status as payment_status,
      tx.gateway_id,
      g.display_name as gateway_name,
      g.provider as gateway_provider,
      tx.external_id as provider_external_id,
      tx.failure_code,
      tx.error_message as payment_error
    from public.checkout_sessions c
    left join public.funnels f on f.id = c.funnel_id and f.organization_id = c.organization_id
    left join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
    left join lateral (
      select t.id, t.status, t.gateway_id, t.external_id, t.failure_code, t.error_message
      from public.gateway_transactions t
      where t.organization_id = c.organization_id
        and t.metadata ? 'checkout_session_id'
        and t.metadata->>'checkout_session_id' = c.id::text
      order by t.created_at desc, t.id desc
      limit 1
    ) tx on true
    left join public.gateways g on g.id = tx.gateway_id and g.organization_id = c.organization_id
    where c.organization_id = v_org
      and (p_from is null or c.created_at >= p_from)
      and (p_to is null or c.created_at < p_to)
      and (p_status is null or p_status = '' or p_status = 'all' or lower(c.status) = lower(p_status))
      and (p_funnel_id is null or p_funnel_id = '' or c.funnel_id = p_funnel_id)
      and (v_query is null or lower(concat_ws(' ', c.id::text, c.customer->>'name', c.customer->>'full_name', c.customer->>'email',
            c.customer->>'phone', f.nome, p.name, c.attribution->>'source', c.attribution->>'campaign',
            tx.external_id, g.display_name, g.provider)) like '%' || v_query || '%')
      and (p_cursor_created_at is null or p_cursor_id is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
    order by c.created_at desc, c.id desc
    limit v_limit + 1
  ),
  page as (
    select * from candidates order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    (select count(*) > v_limit from candidates),
    (select p.created_at from page p order by p.created_at asc, p.id asc limit 1),
    (select p.id from page p order by p.created_at asc, p.id asc limit 1)
  into v_items, v_has_more, v_next_created, v_next_id;

  return jsonb_build_object(
    'items', v_items,
    'metrics', v_metrics,
    'has_more', coalesce(v_has_more, false),
    'next_cursor', case when v_has_more and v_next_id is not null
      then jsonb_build_object('created_at', v_next_created, 'id', v_next_id) else null end
  );
end;
$function$;
revoke all on function public.checkout_operations_page_v1(integer, timestamptz, uuid, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.checkout_operations_page_v1(integer, timestamptz, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
