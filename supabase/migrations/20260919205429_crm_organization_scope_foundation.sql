create or replace function private.set_crm_row_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_default_org uuid;
begin
  if new.user_id is null then
    raise exception 'CRM_USER_REQUIRED' using errcode='23514';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
    raise exception 'CRM_ORGANIZATION_IMMUTABLE' using errcode='23514';
  end if;

  if new.organization_id is null then
    select p.default_organization_id
      into v_default_org
    from public.profiles p
    where p.id = new.user_id;

    new.organization_id := v_default_org;
  end if;

  if new.organization_id is null then
    raise exception 'CRM_ORGANIZATION_REQUIRED' using errcode='23514';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = new.organization_id
      and om.user_id = new.user_id
  ) then
    raise exception 'CRM_USER_ORGANIZATION_MISMATCH' using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.set_crm_row_organization() from public, anon, authenticated;

do $migration$
declare
  v_table text;
  v_constraint text;
  v_index text;
  v_trigger text;
  v_unresolved bigint;
begin
  foreach v_table in array array[
    'crm_agents',
    'crm_ai_actions',
    'crm_channel_accounts',
    'crm_channel_delivery_events',
    'crm_channel_identities',
    'crm_channel_message_outbox',
    'crm_channel_outbox_replay_events',
    'crm_conversation_notes',
    'crm_conversation_tags',
    'crm_conversations',
    'crm_experiment_exposures',
    'crm_experiment_outcomes',
    'crm_experiment_promotions',
    'crm_experiments',
    'crm_messages',
    'crm_predictive_evaluations',
    'crm_quick_replies',
    'crm_segments',
    'crm_tags',
    'crm_tasks',
    'crm_team_members',
    'crm_teams',
    'crm_webhook_events'
  ] loop
    execute format(
      'alter table public.%I add column if not exists organization_id uuid',
      v_table
    );

    execute format(
      'update public.%I x
          set organization_id = p.default_organization_id
         from public.profiles p
        where x.user_id = p.id
          and x.organization_id is null',
      v_table
    );

    execute format(
      'select count(*) from public.%I where organization_id is null',
      v_table
    ) into v_unresolved;

    if v_unresolved <> 0 then
      raise exception 'CRM_ORGANIZATION_BACKFILL_FAILED: table=% unresolved=%', v_table, v_unresolved;
    end if;

    v_constraint := v_table || '_organization_id_fkey';

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
      where n.nspname='public'
        and t.relname=v_table
        and c.conname=v_constraint
    ) then
      execute format(
        'alter table public.%I
           add constraint %I
           foreign key (organization_id)
           references public.organizations(id)
           on delete cascade',
        v_table,
        v_constraint
      );
    end if;

    v_index := v_table || '_organization_id_idx';
    execute format(
      'create index if not exists %I on public.%I(organization_id)',
      v_index,
      v_table
    );

    v_trigger := 'set_' || v_table || '_organization';
    execute format(
      'drop trigger if exists %I on public.%I',
      v_trigger,
      v_table
    );
    execute format(
      'create trigger %I
       before insert or update of user_id, organization_id
       on public.%I
       for each row
       execute function private.set_crm_row_organization()',
      v_trigger,
      v_table
    );

    execute format(
      'alter table public.%I alter column organization_id set not null',
      v_table
    );
  end loop;
end;
$migration$;

create index if not exists crm_conversations_org_updated_idx
  on public.crm_conversations(organization_id, updated_at desc, id desc);

create index if not exists crm_messages_org_conversation_created_idx
  on public.crm_messages(organization_id, conversation_id, created_at desc, id desc);

create index if not exists crm_tasks_org_status_due_idx
  on public.crm_tasks(organization_id, status, due_at, created_at desc);

comment on column public.crm_conversations.organization_id is
  'Canonical organization scope for the conversation. user_id remains legacy owner attribution during the staged multi-user migration.';

comment on column public.crm_messages.organization_id is
  'Canonical organization scope for the message. sender/operator identity remains separate from legacy owner attribution.';
