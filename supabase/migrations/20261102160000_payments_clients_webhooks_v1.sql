-- Fase 3: pagamentos (período + resumo bruto/taxa/líquido), clientes (busca no servidor) e webhooks de saída/Pushcut.

-- 1. Pagamentos: lista com período [p_from, p_to) no lugar de p_days.
drop function if exists public.transactions_list_v1(integer, timestamptz, uuid, text, text, text, text, integer);
create or replace function public.transactions_list_v1(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_status text default null,
  p_gateway_id text default null,
  p_funnel_id text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_values boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_items jsonb;
  v_counts jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.is_org_member(v_org) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if private.has_org_role(v_org, array['attendant']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'INVALID_CURSOR' using errcode='22023'; end if;
  if v_search is not null and length(v_search) > 120 then raise exception 'SEARCH_TOO_LONG' using errcode='22001'; end if;
  v_values := private.has_org_capability(v_org, 'can_view_values');

  with filtered as (
    select t.*
      from public.gateway_transactions t
     where t.organization_id = v_org and t.deleted_at is null
       and (p_from is null or t.created_at >= p_from)
       and (p_to is null or t.created_at < p_to)
       and (p_gateway_id is null or t.gateway_id::text = p_gateway_id)
       and (p_funnel_id is null or t.funnel_id::text = p_funnel_id)
       and (v_search is null
            or t.id::text = v_search
            or lower(coalesce(t.external_id, '')) like '%' || v_search || '%'
            or lower(coalesce(t.customer->>'email', '')) like '%' || v_search || '%'
            or lower(coalesce(t.customer->>'name', t.customer->>'full_name', '')) like '%' || v_search || '%')
  ), page as (
    select * from filtered t
     where (p_status is null or t.status = p_status)
       and (p_before_created_at is null or (t.created_at, t.id) < (p_before_created_at, p_before_id))
     order by t.created_at desc, t.id desc
     limit v_limit + 1
  )
  select
    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from filtered group by status) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'status', t.status, 'external_id', t.external_id,
        'amount', case when v_values then t.amount end, 'currency', t.currency,
        'payment_method', t.metadata->>'payment_method',
        'customer_name', coalesce(t.customer->>'name', t.customer->>'full_name', t.customer->>'buyer_name'),
        'customer_email', t.customer->>'email',
        'funnel_id', t.funnel_id, 'funnel_name', f.nome,
        'product_id', t.product_id, 'product_name', p.name,
        'gateway_id', t.gateway_id, 'gateway_name', g.display_name, 'provider', g.provider,
        'error_message', t.error_message,
        'created_at', t.created_at, 'updated_at', t.updated_at, 'completed_at', t.completed_at
      ) order by t.created_at desc, t.id desc), '[]'::jsonb)
       from page t
       left join public.funnels f on f.id::text = t.funnel_id::text
       left join public.products p on p.id::text = t.product_id::text
       left join public.gateways g on g.id::text = t.gateway_id::text)
  into v_counts, v_items;

  return jsonb_build_object(
    'items', case when jsonb_array_length(v_items) > v_limit then v_items - v_limit else v_items end,
    'next_cursor', case when jsonb_array_length(v_items) > v_limit
                        then jsonb_build_object('created_at', v_items->(v_limit - 1)->'created_at', 'id', v_items->(v_limit - 1)->'id') end,
    'counts', v_counts,
    'can_view_values', v_values,
    'filters', jsonb_build_object(
      'gateways', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by display_name), '[]'::jsonb) from public.gateways where organization_id = v_org),
      'funnels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nome) order by nome), '[]'::jsonb) from public.funnels where organization_id = v_org and deleted_at is null)
    )
  );
end;
$function$;
revoke all on function public.transactions_list_v1(integer, timestamptz, uuid, text, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.transactions_list_v1(integer, timestamptz, uuid, text, text, text, text, timestamptz, timestamptz) to authenticated;

-- Resumo: bruto = aprovadas; taxa = reconciliação (provider_fee) ou metadata da transação; líquido = bruto - taxa.
-- Estornos/chargebacks em % do total capturado (aprovadas + estornadas + chargeback).
create or replace function public.transactions_summary_v1(
  p_from timestamptz default null, p_to timestamptz default null, p_funnel_id text default null, p_gateway_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not private.is_org_member(v_org) or private.has_org_role(v_org, array['attendant'])
     or not private.has_org_capability(v_org, 'can_view_values') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  with tx as (
    select t.status, coalesce(t.amount, 0) as amount,
           coalesce(
             (select sum(ri.provider_fee) from public.reconciliation_items ri where ri.transaction_id = t.id and ri.provider_fee is not null),
             case when coalesce(t.metadata->>'fee', t.metadata->>'provider_fee', t.metadata->>'gateway_fee', '') ~ '^\d+(\.\d+)?$'
                  then coalesce(t.metadata->>'fee', t.metadata->>'provider_fee', t.metadata->>'gateway_fee')::numeric end
           ) as fee
      from public.gateway_transactions t
     where t.organization_id = v_org and t.deleted_at is null
       and (p_from is null or t.created_at >= p_from)
       and (p_to is null or t.created_at < p_to)
       and (p_gateway_id is null or t.gateway_id::text = p_gateway_id)
       and (p_funnel_id is null or t.funnel_id::text = p_funnel_id)
  ), agg as (
    select count(*) as total,
           count(*) filter (where status = 'approved') as approved_count,
           coalesce(sum(amount) filter (where status = 'approved'), 0) as gross,
           coalesce(sum(fee) filter (where status = 'approved'), 0) as fees,
           count(*) filter (where status = 'approved' and fee is not null) as fee_known,
           count(*) filter (where status = 'refunded') as refunded_count,
           coalesce(sum(amount) filter (where status = 'refunded'), 0) as refunded_amount,
           count(*) filter (where status = 'chargeback') as chargeback_count,
           coalesce(sum(amount) filter (where status = 'chargeback'), 0) as chargeback_amount
      from tx
  )
  select jsonb_build_object(
    'total', total, 'approved_count', approved_count,
    'gross', gross, 'fees', fees, 'net', gross - fees,
    'fee_known_count', fee_known, 'fee_missing_count', approved_count - fee_known,
    'refunded_count', refunded_count, 'refunded_amount', refunded_amount,
    'chargeback_count', chargeback_count, 'chargeback_amount', chargeback_amount,
    'refunded_pct', case when gross + refunded_amount + chargeback_amount > 0 then round(100 * refunded_amount / (gross + refunded_amount + chargeback_amount), 2) else 0 end,
    'chargeback_pct', case when gross + refunded_amount + chargeback_amount > 0 then round(100 * chargeback_amount / (gross + refunded_amount + chargeback_amount), 2) else 0 end
  ) into v from agg;
  return v;
end;
$function$;
revoke all on function public.transactions_summary_v1(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.transactions_summary_v1(timestamptz, timestamptz, text, text) to authenticated;

-- 2. Clientes: busca e período no servidor. security invoker: a RLS de clients decide o que o usuário vê.
create or replace function public.clients_page_v1(p_query text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 500)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  with filtered as (
    select c.id, c.data, c.created_at, c.user_id
      from public.clients c
     where c.organization_id = private.current_organization_id()
       and (p_from is null or c.created_at >= p_from)
       and (p_to is null or c.created_at < p_to)
       and (nullif(btrim(coalesce(p_query, '')), '') is null
            or c.id::text = btrim(p_query)
            or c.data::text ilike '%' || replace(replace(left(btrim(p_query), 120), '%', ''), '_', '\_') || '%'
            or (length(regexp_replace(p_query, '\D', '', 'g')) >= 4
                and regexp_replace(c.data::text, '\D', '', 'g') like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                         from (select * from filtered order by created_at desc limit least(greatest(coalesce(p_limit, 500), 1), 2000)) x), '[]'::jsonb));
$function$;
revoke all on function public.clients_page_v1(text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.clients_page_v1(text, timestamptz, timestamptz, integer) to authenticated;

-- 3. Webhooks de saída: por funil, tipo Pushcut, e uma fila alimentada por triggers.
alter table public.outbound_webhooks add column if not exists funnel_id text references public.funnels(id) on delete cascade;
alter table public.outbound_webhooks add column if not exists kind text not null default 'webhook';
alter table public.outbound_webhooks drop constraint if exists outbound_webhooks_kind_check;
alter table public.outbound_webhooks add constraint outbound_webhooks_kind_check check (kind in ('webhook', 'pushcut'));

create table if not exists public.outbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  funnel_id text,
  payload jsonb not null default '{}'::jsonb,
  target_webhook_id uuid,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists outbound_webhook_events_queue_idx on public.outbound_webhook_events (next_attempt_at) where status = 'pending';
alter table public.outbound_webhook_events enable row level security;
revoke all on public.outbound_webhook_events from anon, authenticated;

-- Só enfileira se a org tem um webhook ativo que escuta o evento (evita fila inútil).
create or replace function private.outbound_webhook_enqueue(p_org uuid, p_event text, p_funnel text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_org is null or not exists (
    select 1 from public.outbound_webhooks w
     where w.organization_id = p_org and w.status = 'active'
       and (p_event = any (w.events) or '*' = any (w.events))
       and (w.funnel_id is null or w.funnel_id = p_funnel)) then
    return;
  end if;
  insert into public.outbound_webhook_events (organization_id, event_type, funnel_id, payload)
  values (p_org, p_event, p_funnel, p_payload);
  perform private.outbound_webhook_kick();
end;
$function$;

-- Acorda o dispatcher logo após o commit (pg_net é assíncrono). Falha aqui nunca derruba o pagamento/mensagem:
-- o cron de 5 em 5 minutos recolhe o que ficou.
create or replace function private.outbound_webhook_kick()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/outbound-webhook-dispatcher',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ALTHEA_INTERNAL_SECRET' limit 1)),
    body := '{}'::jsonb);
exception when others then
  null;
end;
$function$;
revoke all on function private.outbound_webhook_kick() from public, anon, authenticated;
revoke all on function private.outbound_webhook_enqueue(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.outbound_webhook_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.status not in ('approved', 'pending', 'failed', 'refunded', 'chargeback') or new.deleted_at is not null
     or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;
  perform private.outbound_webhook_enqueue(new.organization_id, 'transaction.' || new.status, new.funnel_id::text, jsonb_build_object(
    'transaction_id', new.id, 'status', new.status, 'amount', new.amount, 'currency', new.currency,
    'payment_method', new.metadata->>'payment_method', 'external_id', new.external_id,
    'checkout_id', new.metadata->>'checkout_session_id',
    'customer', jsonb_build_object('name', coalesce(new.customer->>'name', new.customer->>'full_name'),
                                   'email', new.customer->>'email', 'phone', coalesce(new.customer->>'phone', new.customer->>'whatsapp')),
    'funnel_id', new.funnel_id, 'funnel_name', (select f.nome from public.funnels f where f.id::text = new.funnel_id::text),
    'product_id', new.product_id, 'product_name', (select p.name from public.products p where p.id::text = new.product_id::text),
    'occurred_at', now()));
  return new;
end;
$function$;
revoke all on function private.outbound_webhook_on_transaction() from public, anon, authenticated;
drop trigger if exists trg_outbound_webhook_on_transaction on public.gateway_transactions;
create trigger trg_outbound_webhook_on_transaction
after insert or update of status on public.gateway_transactions
for each row execute function private.outbound_webhook_on_transaction();

-- Mensagem recebida (WhatsApp ou chat do funil), exceto contato bloqueado e mensagens internas.
create or replace function private.outbound_webhook_on_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  c record;
begin
  if new.direction is distinct from 'inbound' or new.channel = 'internal' then return new; end if;
  select id, organization_id, funnel_id, buyer_name, buyer_email, customer_whatsapp, primary_channel, blocked
    into c from public.crm_conversations where id = new.conversation_id;
  if not found or c.blocked then return new; end if;
  perform private.outbound_webhook_enqueue(c.organization_id, 'message.received', c.funnel_id, jsonb_build_object(
    'conversation_id', c.id, 'message_id', new.id, 'channel', new.channel, 'body', left(coalesce(new.body, ''), 500),
    'customer', jsonb_build_object('name', c.buyer_name, 'email', c.buyer_email, 'phone', c.customer_whatsapp),
    'funnel_id', c.funnel_id, 'funnel_name', (select f.nome from public.funnels f where f.id = c.funnel_id),
    'occurred_at', new.created_at));
  return new;
end;
$function$;
revoke all on function private.outbound_webhook_on_message() from public, anon, authenticated;
drop trigger if exists zz_outbound_webhook_on_message on public.crm_messages;
create trigger zz_outbound_webhook_on_message
after insert on public.crm_messages
for each row execute function private.outbound_webhook_on_message();

-- Dispatcher: pega a fila, lê o segredo do Vault e fecha cada evento.
create or replace function public.outbound_webhook_claim_v1(p_limit integer default 25)
returns setof public.outbound_webhook_events
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.outbound_webhook_events e
     set status = 'processing', attempts = e.attempts + 1
   where e.id in (select id from public.outbound_webhook_events
                   where status = 'pending' and next_attempt_at <= now()
                   order by next_attempt_at limit least(greatest(coalesce(p_limit, 25), 1), 100)
                   for update skip locked)
  returning e.*;
$function$;

-- p_retry: algum webhook falhou de forma recuperável -> volta para a fila com espera (até 5 tentativas).
create or replace function public.outbound_webhook_finish_v1(p_event_id uuid, p_retry boolean)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.outbound_webhook_events
     set status = case when p_retry and attempts < 5 then 'pending' else 'done' end,
         next_attempt_at = now() + make_interval(mins => power(2, attempts)::int),
         processed_at = case when p_retry and attempts < 5 then null else now() end
   where id = p_event_id;
$function$;

create or replace function public.outbound_webhook_secret_v1(p_webhook_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select s.decrypted_secret
    from public.outbound_webhooks w
    join vault.decrypted_secrets s on s.id::text = w.secret_ref
   where w.id = p_webhook_id;
$function$;

-- Botão "Enviar teste": evento só para um webhook, ignorando os eventos que ele escuta.
create or replace function public.outbound_webhook_test_v1(p_webhook_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
begin
  if auth.uid() is null or v_org is null or not private.has_org_capability(v_org, 'can_manage_integrations') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.outbound_webhooks where id = p_webhook_id and organization_id = v_org) then
    raise exception 'WEBHOOK_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.outbound_webhook_events (organization_id, event_type, payload, target_webhook_id)
  values (v_org, 'webhook.test', jsonb_build_object('message', 'Teste da Althea Pay', 'occurred_at', now()), p_webhook_id);
  perform private.outbound_webhook_kick();
end;
$function$;

revoke all on function public.outbound_webhook_claim_v1(integer) from public, anon, authenticated;
revoke all on function public.outbound_webhook_finish_v1(uuid, boolean) from public, anon, authenticated;
revoke all on function public.outbound_webhook_secret_v1(uuid) from public, anon, authenticated;
revoke all on function public.outbound_webhook_test_v1(uuid) from public, anon;
grant execute on function public.outbound_webhook_claim_v1(integer) to service_role;
grant execute on function public.outbound_webhook_finish_v1(uuid, boolean) to service_role;
grant execute on function public.outbound_webhook_secret_v1(uuid) to service_role;
grant execute on function public.outbound_webhook_test_v1(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'althea-outbound-webhook-dispatcher';
  perform cron.schedule('althea-outbound-webhook-dispatcher', '*/5 * * * *', 'select private.outbound_webhook_kick();');
end $$;
