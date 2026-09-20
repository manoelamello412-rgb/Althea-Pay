-- Phase 2: organization-aware identity lookup indexes.
-- Review-gated only. Do not apply before the compatible writers from PRs #111 and #109 are in production.

do $guard$
declare
  v_def text;
  v_register_def text;
  v_unsafe_events bigint;
  v_bad_org_rows bigint;
begin
  -- Canonical tenant columns must still be present and NOT NULL.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sales'
      and column_name='organization_id' and data_type='uuid' and is_nullable='NO'
  ) then
    raise exception 'identity_migration_guard: unexpected sales.organization_id schema';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='integration_events'
      and column_name='organization_id' and data_type='uuid' and is_nullable='NO'
  ) then
    raise exception 'identity_migration_guard: unexpected integration_events.organization_id schema';
  end if;

  -- Legacy blockers must exist exactly as audited.
  select pg_get_indexdef(to_regclass('public.sales_user_external_unique')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX sales_user_external_unique ON public.sales USING btree (user_id, external_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected sales_user_external_unique definition: %', coalesce(v_def,'<missing>');
  end if;

  select pg_get_indexdef(to_regclass('public.integration_events_user_external_unique')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX integration_events_user_external_unique ON public.integration_events USING btree (user_id, external_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected integration_events_user_external_unique definition: %', coalesce(v_def,'<missing>');
  end if;

  -- Idempotency and primary-key contracts that must be preserved.
  select pg_get_indexdef(to_regclass('public.integration_events_event_key_uidx')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX integration_events_event_key_uidx ON public.integration_events USING btree (event_key) WHERE (event_key IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected integration_events_event_key_uidx definition: %', coalesce(v_def,'<missing>');
  end if;

  select pg_get_indexdef(to_regclass('public.sales_user_transaction_unique')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX sales_user_transaction_unique ON public.sales USING btree (user_id, transaction_id) WHERE (transaction_id IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected sales_user_transaction_unique definition: %', coalesce(v_def,'<missing>');
  end if;

  select pg_get_indexdef(to_regclass('public.sales_pkey')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX sales_pkey ON public.sales USING btree (id)' then
    raise exception 'identity_migration_guard: unexpected sales_pkey definition: %', coalesce(v_def,'<missing>');
  end if;

  select pg_get_indexdef(to_regclass('public.integration_events_pkey')) into v_def;
  if v_def is distinct from 'CREATE UNIQUE INDEX integration_events_pkey ON public.integration_events USING btree (id)' then
    raise exception 'identity_migration_guard: unexpected integration_events_pkey definition: %', coalesce(v_def,'<missing>');
  end if;

  -- If target lookup indexes already exist, they must match the reviewed definitions.
  select pg_get_indexdef(to_regclass('public.sales_org_external_gateway_idx')) into v_def;
  if v_def is not null and v_def is distinct from 'CREATE INDEX sales_org_external_gateway_idx ON public.sales USING btree (organization_id, external_id, gateway_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected sales_org_external_gateway_idx definition: %', v_def;
  end if;

  select pg_get_indexdef(to_regclass('public.integration_events_org_funnel_external_idx')) into v_def;
  if v_def is not null and v_def is distinct from 'CREATE INDEX integration_events_org_funnel_external_idx ON public.integration_events USING btree (organization_id, funnel_id, external_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_guard: unexpected integration_events_org_funnel_external_idx definition: %', v_def;
  end if;

  -- Never remove the legacy event uniqueness while raw external IDs exist without a canonical event_key.
  select count(*) into v_unsafe_events
  from public.integration_events
  where external_id is not null and event_key is null;

  if v_unsafe_events <> 0 then
    raise exception 'identity_migration_guard: % integration_events have external_id but no event_key; no automatic backfill is permitted', v_unsafe_events;
  end if;

  -- Defense in depth in case NOT NULL constraints drift before application.
  select
    (select count(*) from public.sales where organization_id is null)
    +
    (select count(*) from public.integration_events where organization_id is null)
  into v_bad_org_rows;

  if v_bad_org_rows <> 0 then
    raise exception 'identity_migration_guard: % tenant rows have null organization_id', v_bad_org_rows;
  end if;

  -- register_integration_event must continue to rely on the preserved canonical event-key uniqueness.
  select pg_get_functiondef(
    to_regprocedure('public.register_integration_event(text,text,text,jsonb,timestamp with time zone)')
  ) into v_register_def;

  if v_register_def is null
     or position('on conflict (event_key) where event_key is not null' in lower(v_register_def)) = 0 then
    raise exception 'identity_migration_guard: register_integration_event event_key conflict contract is missing or unexpected';
  end if;
end
$guard$;

-- Add organization-aware lookup support before removing legacy uniqueness.
create index if not exists sales_org_external_gateway_idx
  on public.sales (organization_id, external_id, gateway_id)
  where external_id is not null;

create index if not exists integration_events_org_funnel_external_idx
  on public.integration_events (organization_id, funnel_id, external_id)
  where external_id is not null;

-- Remove only the two reviewed legacy cross-organization blockers.
drop index public.sales_user_external_unique;
drop index public.integration_events_user_external_unique;

do $post_guard$
declare
  v_def text;
begin
  if to_regclass('public.sales_user_external_unique') is not null
     or to_regclass('public.integration_events_user_external_unique') is not null then
    raise exception 'identity_migration_post_guard: legacy identity indexes were not removed';
  end if;

  select pg_get_indexdef(to_regclass('public.sales_org_external_gateway_idx')) into v_def;
  if v_def is distinct from 'CREATE INDEX sales_org_external_gateway_idx ON public.sales USING btree (organization_id, external_id, gateway_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_post_guard: sales organization-aware lookup index is missing or unexpected';
  end if;

  select pg_get_indexdef(to_regclass('public.integration_events_org_funnel_external_idx')) into v_def;
  if v_def is distinct from 'CREATE INDEX integration_events_org_funnel_external_idx ON public.integration_events USING btree (organization_id, funnel_id, external_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'identity_migration_post_guard: integration-events organization-aware lookup index is missing or unexpected';
  end if;

  if to_regclass('public.integration_events_event_key_uidx') is null
     or to_regclass('public.sales_user_transaction_unique') is null
     or to_regclass('public.sales_pkey') is null
     or to_regclass('public.integration_events_pkey') is null then
    raise exception 'identity_migration_post_guard: a preserved idempotency or primary-key index is missing';
  end if;
end
$post_guard$;
