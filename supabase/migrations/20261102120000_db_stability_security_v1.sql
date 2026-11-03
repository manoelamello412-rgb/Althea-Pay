-- Fase 0: alívio de carga (522 no login) e fechamento de funções internas.

-- 1. Cron: espaça os workers HTTP que não têm latência visível ao usuário.
--    Mantidos a cada minuto: gateway-webhook-processor (aprovação de PIX) e
--    crm-outbox-dispatcher (resposta do atendente no chat do funil).
do $$
declare r record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  for r in
    select j.jobid, v.schedule
      from (values
        ('althea-event-worker',             '*/2 * * * *'),
        ('althea-funnel-command-worker',    '*/2 * * * *'),
        ('althea-checkout-recovery-worker', '*/2 * * * *'),
        ('althea-gateway-attempt-recovery', '*/5 * * * *')
      ) v(jobname, schedule)
      join cron.job j on j.jobname = v.jobname
  loop
    perform cron.alter_job(r.jobid, schedule := r.schedule);
  end loop;
end $$;

-- 2. Índices para as consultas que rodam a cada minuto.
create index if not exists gateway_transactions_checkout_session_idx
  on public.gateway_transactions (organization_id, (metadata->>'checkout_session_id'), status)
  where metadata ? 'checkout_session_id';

create index if not exists crm_conversations_inactivity_idx
  on public.crm_conversations (last_activity_at)
  where checkout_status = 'no_checkout'::public.lead_checkout_status and status <> 'closed';

-- 3. enqueue_payment_pending_events: o join usava cs.id::text, o que impedia o uso da PK.
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

-- 4. Retenção: histórico do cron e buckets de rate limit crescem sem limite.
create or replace function private.housekeeping_v1()
returns void
language plpgsql
security definer
set search_path = private, public, pg_catalog
as $function$
begin
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  delete from private.funnel_event_rate_limit_buckets where updated_at < now() - interval '1 day';
  perform public.cleanup_althea_api_rate_limits();
end;
$function$;
revoke all on function private.housekeeping_v1() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'althea-housekeeping';
  perform cron.schedule('althea-housekeeping', '17 3 * * *', 'select private.housekeeping_v1();');
end $$;

-- 5. Funções internas: "revoke from public" não remove o grant default do Supabase
--    para anon/authenticated. Fecha todas as sobrecargas destes nomes.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname = any (array[
              'crm_claim_scheduled_automation_executions',
              'claim_gateway_payment_link_execution',
              'complete_gateway_payment_link_execution',
              'fail_gateway_payment_link_execution',
              'select_gateway_for_funnel',
              'check_checkout_inactivity',
              'crm_ingest_funnel_chat_message',
              'record_gateway_health',
              'cleanup_althea_api_rate_limits'])
            or p.proname like 'server\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 6. merchant_business_profiles: trava CPF/CNPJ e IE no banco e impede o usuário
--    de gravar financial_metrics (só service_role).
create or replace function private.merchant_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.document_number, '') <> '' and new.document_number is distinct from old.document_number then
      raise exception 'DOCUMENT_LOCKED' using errcode = '42501';
    end if;
    if coalesce(old.operation_metadata->>'state_registration', '') <> ''
       and new.operation_metadata->>'state_registration' is distinct from old.operation_metadata->>'state_registration' then
      raise exception 'STATE_REGISTRATION_LOCKED' using errcode = '42501';
    end if;
    new.operation_metadata := jsonb_set(coalesce(new.operation_metadata, '{}'::jsonb), '{financial_metrics}',
      coalesce(old.operation_metadata->'financial_metrics', '{}'::jsonb));
  else
    new.operation_metadata := coalesce(new.operation_metadata, '{}'::jsonb) - 'financial_metrics';
  end if;
  return new;
end;
$function$;
revoke all on function private.merchant_profile_guard() from public, anon, authenticated;

drop trigger if exists merchant_profile_guard on public.merchant_business_profiles;
create trigger merchant_profile_guard
  before insert or update on public.merchant_business_profiles
  for each row execute function private.merchant_profile_guard();
