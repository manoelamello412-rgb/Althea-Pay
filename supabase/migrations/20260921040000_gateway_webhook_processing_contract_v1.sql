-- G1-A: gateway webhook processing queue + multi-gateway identity contract.
-- Code-only until explicitly authorized for production rollout.

do $g1a_pre_guard$
declare
  v_constraint_def text;
begin
  if to_regclass('public.gateway_webhook_events') is null then
    raise exception 'g1a_pre_guard: gateway_webhook_events missing';
  end if;

  if to_regprocedure('public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)') is null then
    raise exception 'g1a_pre_guard: process_gateway_webhook_v11 signature missing';
  end if;

  if md5(pg_get_functiondef(
    'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)'::regprocedure
  )) <> '002e7aa207d2d2c12f98f2811be05d8f' then
    raise exception 'g1a_pre_guard: process_gateway_webhook_v11 fingerprint mismatch';
  end if;

  if to_regprocedure('public.ingest_gateway_webhook(text,text,timestamptz,jsonb)') is null then
    raise exception 'g1a_pre_guard: ingest_gateway_webhook signature missing';
  end if;

  if to_regprocedure('public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb)') is null then
    raise exception 'g1a_pre_guard: ingest_gateway_webhook_v2 signature missing';
  end if;

  select pg_get_constraintdef(c.oid, true)
    into v_constraint_def
  from pg_constraint c
  where c.conrelid='public.gateway_webhook_events'::regclass
    and c.conname='gateway_webhook_events_provider_provider_event_id_key'
    and c.contype='u';

  if v_constraint_def is distinct from 'UNIQUE (provider, provider_event_id)' then
    raise exception 'g1a_pre_guard: global webhook identity constraint is missing or unexpected';
  end if;

  if exists (
    select 1
    from public.gateway_webhook_events
    where gateway_id is not null
    group by gateway_id, provider, provider_event_id
    having count(*) > 1
  ) then
    raise exception 'g1a_pre_guard: gateway-scoped webhook identity duplicates exist';
  end if;

  if exists (
    select 1
    from public.gateway_webhook_events
    where gateway_id is null
    group by provider, provider_event_id
    having count(*) > 1
  ) then
    raise exception 'g1a_pre_guard: legacy null-gateway webhook identity duplicates exist';
  end if;

  if has_table_privilege('service_role','public.gateway_webhook_events','SELECT')
     or has_table_privilege('service_role','public.gateway_webhook_events','INSERT')
     or has_table_privilege('service_role','public.gateway_webhook_events','UPDATE')
     or has_table_privilege('service_role','public.gateway_webhook_events','DELETE') then
    raise exception 'g1a_pre_guard: service_role direct gateway_webhook_events DML must remain disabled';
  end if;
end
$g1a_pre_guard$;

create unique index if not exists gateway_webhook_events_gateway_provider_event_id_key
  on public.gateway_webhook_events(gateway_id,provider,provider_event_id)
  where gateway_id is not null;

create unique index if not exists gateway_webhook_events_legacy_provider_event_id_key
  on public.gateway_webhook_events(provider,provider_event_id)
  where gateway_id is null;

create or replace function public.ingest_gateway_webhook(
  p_provider text,
  p_provider_event_id text,
  p_signature_timestamp timestamptz,
  p_payload jsonb
)
returns table(duplicate boolean, webhook_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_provider text;
  v_provider_event_id text;
begin
  if coalesce(length(trim(p_provider)),0)=0
     or coalesce(length(trim(p_provider_event_id)),0)=0 then
    raise exception 'provider_and_event_id_required';
  end if;

  v_provider:=lower(trim(p_provider));
  v_provider_event_id:=trim(p_provider_event_id);

  insert into public.gateway_webhook_events(
    provider,provider_event_id,signature_timestamp,payload
  )
  values(
    v_provider,v_provider_event_id,p_signature_timestamp,coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (provider,provider_event_id) where gateway_id is null do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
    from public.gateway_webhook_events e
    where e.gateway_id is null
      and e.provider=v_provider
      and e.provider_event_id=v_provider_event_id
    limit 1;

    if v_id is not null then
      return query select true,v_id;
    end if;

    raise exception 'webhook_ingestion_conflict';
  end if;

  return query select false,v_id;
end
$function$;

create or replace function public.ingest_gateway_webhook_v2(
  p_gateway_id text,
  p_provider text,
  p_provider_event_id text,
  p_signature_timestamp timestamptz,
  p_payload jsonb
)
returns table(duplicate boolean, webhook_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_provider text;
  v_gateway_provider text;
  v_gateway_id text;
  v_provider_event_id text;
begin
  if coalesce(length(trim(p_gateway_id)),0)=0
     or coalesce(length(trim(p_provider)),0)=0
     or coalesce(length(trim(p_provider_event_id)),0)=0 then
    raise exception 'gateway_provider_and_event_id_required';
  end if;

  v_gateway_id:=trim(p_gateway_id);
  v_provider:=lower(trim(p_provider));
  v_provider_event_id:=trim(p_provider_event_id);

  select lower(trim(provider)) into v_gateway_provider
  from public.gateways
  where id=v_gateway_id
  limit 1;

  if v_gateway_provider is null then
    raise exception 'gateway_not_found';
  end if;

  if v_gateway_provider<>v_provider then
    raise exception 'gateway_provider_mismatch';
  end if;

  insert into public.gateway_webhook_events(
    gateway_id,provider,provider_event_id,signature_timestamp,payload,
    status,received_at,updated_at,next_attempt_at
  )
  values(
    v_gateway_id,v_provider,v_provider_event_id,p_signature_timestamp,
    coalesce(p_payload,'{}'::jsonb),'accepted',now(),now(),now()
  )
  on conflict (gateway_id,provider,provider_event_id)
    where gateway_id is not null
    do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
    from public.gateway_webhook_events e
    where e.gateway_id=v_gateway_id
      and e.provider=v_provider
      and e.provider_event_id=v_provider_event_id
    limit 1;

    if v_id is not null then
      return query select true,v_id;
    end if;

    raise exception 'webhook_ingestion_conflict';
  end if;

  return query select false,v_id;
end
$function$;

alter table public.gateway_webhook_events
  drop constraint gateway_webhook_events_provider_provider_event_id_key;

create or replace function public.server_claim_gateway_webhook_events_v1(
  p_limit integer default 50,
  p_webhook_id uuid default null
)
returns table(
  webhook_id uuid,
  provider text,
  provider_event_id text,
  payload jsonb,
  gateway_id text,
  user_id uuid,
  organization_id uuid,
  transaction_id uuid,
  claim_attempt integer,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_limit integer:=coalesce(p_limit,50);
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if v_limit < 1 or v_limit > 50 then
    raise exception 'gateway_webhook_claim_limit_invalid' using errcode='22023';
  end if;

  return query
  with candidates as (
    select e.id
    from public.gateway_webhook_events e
    where (p_webhook_id is null or e.id=p_webhook_id)
      and (
        (e.status='accepted' and e.attempts < 8)
        or (
          e.status='failed'
          and e.attempts < 8
          and (e.next_attempt_at is null or e.next_attempt_at <= now())
        )
        or (
          e.status='processing'
          and e.updated_at <= now() - interval '5 minutes'
          and e.attempts <= 8
        )
      )
    order by e.received_at asc, e.id asc
    limit case when p_webhook_id is null then v_limit else 1 end
    for update skip locked
  ),
  claimed as (
    update public.gateway_webhook_events e
       set status=case
             when e.status='processing' and e.attempts >= 8 then 'dead_letter'
             else 'processing'
           end,
           attempts=case
             when e.status='processing' and e.attempts >= 8 then e.attempts
             else e.attempts+1
           end,
           last_error=case
             when e.status='processing' and e.attempts >= 8
               then coalesce(e.last_error,'stale_processing_attempt_limit_exhausted')
             else e.last_error
           end,
           next_attempt_at=null,
           updated_at=now()
      from candidates c
     where e.id=c.id
    returning e.*
  )
  select
    c.id,
    c.provider,
    c.provider_event_id,
    c.payload,
    c.gateway_id,
    c.user_id,
    c.organization_id,
    c.transaction_id,
    c.attempts,
    c.received_at
  from claimed c
  where c.status='processing'
  order by c.received_at asc, c.id asc;
end
$function$;

create or replace function public.server_process_claimed_gateway_webhook_v1(
  p_webhook_id uuid,
  p_expected_attempt integer,
  p_next_status text,
  p_external_transaction_id text,
  p_failure_code text default null,
  p_event_kind text default 'payment',
  p_amount numeric default null,
  p_currency text default null,
  p_external_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_event public.gateway_webhook_events%rowtype;
  v_gateway public.gateways%rowtype;
  v_tx public.gateway_transactions%rowtype;
  v_tx_count integer;
  v_result jsonb;
  v_external text:=nullif(trim(coalesce(p_external_transaction_id,'')),'');
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_webhook_id is null or p_expected_attempt is null or p_expected_attempt < 1 then
    raise exception 'gateway_webhook_claim_identity_required' using errcode='22023';
  end if;

  if v_external is null then
    raise exception 'webhook_identity_required' using errcode='22023';
  end if;

  select e.* into v_event
  from public.gateway_webhook_events e
  where e.id=p_webhook_id
    and e.status='processing'
    and e.attempts=p_expected_attempt
  for update;

  if not found then
    raise exception 'gateway_webhook_fencing_lost' using errcode='40001';
  end if;

  if v_event.gateway_id is null
     or v_event.user_id is null
     or v_event.organization_id is null then
    raise exception 'tenant_context_missing' using errcode='22023';
  end if;

  select g.* into v_gateway
  from public.gateways g
  where g.id=v_event.gateway_id
    and g.user_id=v_event.user_id
    and g.organization_id=v_event.organization_id
  for update;

  if not found then
    raise exception 'gateway_tenant_mismatch' using errcode='42501';
  end if;

  select count(*) into v_tx_count
  from public.gateway_transactions t
  where t.gateway_id=v_event.gateway_id
    and t.user_id=v_event.user_id
    and t.external_id=v_external;

  if v_tx_count <> 1 then
    raise exception 'transaction_tenant_mismatch' using errcode='42501';
  end if;

  select t.* into v_tx
  from public.gateway_transactions t
  where t.gateway_id=v_event.gateway_id
    and t.user_id=v_event.user_id
    and t.organization_id=v_event.organization_id
    and t.external_id=v_external
  for update;

  if not found then
    raise exception 'transaction_tenant_mismatch' using errcode='42501';
  end if;

  if v_event.transaction_id is not null
     and v_event.transaction_id <> v_tx.id then
    raise exception 'transaction_tenant_mismatch' using errcode='42501';
  end if;

  select public.process_gateway_webhook_v11(
    p_webhook_id,
    p_next_status,
    v_external,
    p_failure_code,
    p_event_kind,
    p_amount,
    p_currency,
    p_external_event_id
  ) into v_result;

  return v_result;
end
$function$;

create or replace function public.server_fail_gateway_webhook_event_v1(
  p_webhook_id uuid,
  p_expected_attempt integer,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_attempts integer;
  v_delay_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_webhook_id is null or p_expected_attempt is null or p_expected_attempt < 1 then
    return false;
  end if;

  select e.status,e.attempts
    into v_status,v_attempts
  from public.gateway_webhook_events e
  where e.id=p_webhook_id
  for update;

  if not found or v_attempts<>p_expected_attempt then
    return false;
  end if;

  if v_status='failed' then
    return true;
  end if;

  if v_status<>'processing' or p_expected_attempt>=8 then
    return false;
  end if;

  v_delay_seconds:=least(
    3600,
    (30 * power(2::numeric,p_expected_attempt-1))::integer
  );

  update public.gateway_webhook_events
     set status='failed',
         last_error=left(p_error,2000),
         next_attempt_at=now()+make_interval(secs=>v_delay_seconds),
         updated_at=now()
   where id=p_webhook_id
     and status='processing'
     and attempts=p_expected_attempt;

  return found;
end
$function$;

create or replace function public.server_dead_letter_gateway_webhook_event_v1(
  p_webhook_id uuid,
  p_expected_attempt integer,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_attempts integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_webhook_id is null or p_expected_attempt is null or p_expected_attempt < 1 then
    return false;
  end if;

  select e.status,e.attempts
    into v_status,v_attempts
  from public.gateway_webhook_events e
  where e.id=p_webhook_id
  for update;

  if not found or v_attempts<>p_expected_attempt then
    return false;
  end if;

  if v_status='dead_letter' then
    return true;
  end if;

  if v_status<>'processing' then
    return false;
  end if;

  update public.gateway_webhook_events
     set status='dead_letter',
         last_error=left(p_error,2000),
         next_attempt_at=null,
         updated_at=now()
   where id=p_webhook_id
     and status='processing'
     and attempts=p_expected_attempt;

  return found;
end
$function$;

alter function public.server_claim_gateway_webhook_events_v1(integer,uuid) owner to postgres;
alter function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) owner to postgres;
alter function public.server_fail_gateway_webhook_event_v1(uuid,integer,text) owner to postgres;
alter function public.server_dead_letter_gateway_webhook_event_v1(uuid,integer,text) owner to postgres;

revoke all on function public.server_claim_gateway_webhook_events_v1(integer,uuid) from public, anon, authenticated;
revoke all on function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) from public, anon, authenticated;
revoke all on function public.server_fail_gateway_webhook_event_v1(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.server_dead_letter_gateway_webhook_event_v1(uuid,integer,text) from public, anon, authenticated;

grant execute on function public.server_claim_gateway_webhook_events_v1(integer,uuid) to service_role;
grant execute on function public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text) to service_role;
grant execute on function public.server_fail_gateway_webhook_event_v1(uuid,integer,text) to service_role;
grant execute on function public.server_dead_letter_gateway_webhook_event_v1(uuid,integer,text) to service_role;

do $g1a_post_guard$
declare
  v_rpc oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_public_execute boolean;
  v_v11_md5 text;
  v_ingest text;
  v_ingest_v2 text;
begin
  foreach v_rpc in array array[
    to_regprocedure('public.server_claim_gateway_webhook_events_v1(integer,uuid)')::oid,
    to_regprocedure('public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)')::oid,
    to_regprocedure('public.server_fail_gateway_webhook_event_v1(uuid,integer,text)')::oid,
    to_regprocedure('public.server_dead_letter_gateway_webhook_event_v1(uuid,integer,text)')::oid
  ] loop
    if v_rpc is null then
      raise exception 'g1a_post_guard: required gateway webhook RPC missing';
    end if;

    select pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
      into v_owner,v_security_definer,v_config
    from pg_proc p
    where p.oid=v_rpc;

    if v_owner<>'postgres' or not v_security_definer then
      raise exception 'g1a_post_guard: gateway webhook RPC owner/security mismatch';
    end if;

    if not (coalesce(v_config,ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']) then
      raise exception 'g1a_post_guard: gateway webhook RPC search_path mismatch';
    end if;

    if not has_function_privilege('service_role',v_rpc,'EXECUTE')
       or has_function_privilege('anon',v_rpc,'EXECUTE')
       or has_function_privilege('authenticated',v_rpc,'EXECUTE') then
      raise exception 'g1a_post_guard: gateway webhook RPC ACL mismatch';
    end if;

    select exists(
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=v_rpc
        and a.grantee=0
        and a.privilege_type='EXECUTE'
    ) into v_public_execute;

    if v_public_execute then
      raise exception 'g1a_post_guard: PUBLIC execute remains on gateway webhook RPC';
    end if;
  end loop;

  if has_table_privilege('service_role','public.gateway_webhook_events','SELECT')
     or has_table_privilege('service_role','public.gateway_webhook_events','INSERT')
     or has_table_privilege('service_role','public.gateway_webhook_events','UPDATE')
     or has_table_privilege('service_role','public.gateway_webhook_events','DELETE') then
    raise exception 'g1a_post_guard: service_role direct gateway_webhook_events DML must remain disabled';
  end if;

  if exists (
    select 1
    from pg_constraint c
    where c.conrelid='public.gateway_webhook_events'::regclass
      and c.conname='gateway_webhook_events_provider_provider_event_id_key'
  ) then
    raise exception 'g1a_post_guard: global webhook identity constraint still exists';
  end if;

  if not exists (
    select 1
    from pg_index i
    where i.indexrelid='public.gateway_webhook_events_gateway_provider_event_id_key'::regclass
      and i.indisunique
      and pg_get_expr(i.indpred,i.indrelid)='(gateway_id IS NOT NULL)'
      and pg_get_indexdef(i.indexrelid) like '%(gateway_id, provider, provider_event_id)%'
  ) then
    raise exception 'g1a_post_guard: gateway-scoped webhook identity index missing';
  end if;

  if not exists (
    select 1
    from pg_index i
    where i.indexrelid='public.gateway_webhook_events_legacy_provider_event_id_key'::regclass
      and i.indisunique
      and pg_get_expr(i.indpred,i.indrelid)='(gateway_id IS NULL)'
      and pg_get_indexdef(i.indexrelid) like '%(provider, provider_event_id)%'
  ) then
    raise exception 'g1a_post_guard: legacy null-gateway identity index missing';
  end if;

  select regexp_replace(lower(pg_get_functiondef(
    'public.ingest_gateway_webhook(text,text,timestamptz,jsonb)'::regprocedure
  )),E'\\s+',' ','g') into v_ingest;

  if position(
    'on conflict (provider,provider_event_id) where gateway_id is null do nothing'
    in v_ingest
  )=0 then
    raise exception 'g1a_post_guard: legacy ingest is not null-gateway scoped';
  end if;

  select regexp_replace(lower(pg_get_functiondef(
    'public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb)'::regprocedure
  )),E'\\s+',' ','g') into v_ingest_v2;

  if position(
    'on conflict (gateway_id,provider,provider_event_id) where gateway_id is not null do nothing'
    in v_ingest_v2
  )=0 then
    raise exception 'g1a_post_guard: v2 ingest is not gateway scoped';
  end if;

  select md5(pg_get_functiondef(
    'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)'::regprocedure
  )) into v_v11_md5;

  if v_v11_md5 <> '002e7aa207d2d2c12f98f2811be05d8f' then
    raise exception 'g1a_post_guard: process_gateway_webhook_v11 changed unexpectedly';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'g1a_post_guard: service_role must retain v11 execute during G1-A';
  end if;
end
$g1a_post_guard$;
