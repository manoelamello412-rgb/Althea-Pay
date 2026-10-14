-- Organization-scoped reads, stage B.
-- Tables whose RLS was still owner-only get an organization_id (backfilled from the owner's default
-- organization and filled on insert) plus an additive organization read policy. Existing owner policies
-- are kept, so the owner path and every service-role writer behave exactly as before.
-- Not covered on purpose: crm_ai_actions (CRM rows reach non-owners only through capability RPCs),
-- platform_settings / merchant_business_profiles (workers read them by owner user_id).

create or replace function private.fill_owner_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if new.organization_id is null and new.user_id is not null then
    select p.default_organization_id into new.organization_id
      from public.profiles p
     where p.id = new.user_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.fill_owner_organization() from public, anon, authenticated;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'api_request_logs',
    'outbound_webhooks',
    'outbound_webhook_deliveries',
    'transaction_routing_logs'
  ] loop
    execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade', v_table);
    -- ponytail: single-statement backfill; batch it if these log tables grow past a few million rows.
    execute format(
      'update public.%I x set organization_id = p.default_organization_id
         from public.profiles p
        where x.user_id = p.id and x.organization_id is null',
      v_table);
    execute format('create index if not exists %I on public.%I(organization_id, created_at desc)', v_table || '_organization_created_idx', v_table);
    execute format('drop trigger if exists %I on public.%I', 'fill_' || v_table || '_organization', v_table);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function private.fill_owner_organization()',
      'fill_' || v_table || '_organization', v_table);
  end loop;
end;
$migration$;

-- Deliveries belong to their webhook's organization, not to whatever the owner's default is today.
update public.outbound_webhook_deliveries d
   set organization_id = w.organization_id
  from public.outbound_webhooks w
 where w.id = d.webhook_id
   and w.organization_id is not null
   and d.organization_id is distinct from w.organization_id;

drop policy if exists api_request_logs_org_select on public.api_request_logs;
create policy api_request_logs_org_select on public.api_request_logs
  for select to authenticated using ((select private.is_org_member(organization_id)));

drop policy if exists outbound_webhooks_org_select on public.outbound_webhooks;
create policy outbound_webhooks_org_select on public.outbound_webhooks
  for select to authenticated using ((select private.is_org_member(organization_id)));

drop policy if exists outbound_webhook_deliveries_org_select on public.outbound_webhook_deliveries;
create policy outbound_webhook_deliveries_org_select on public.outbound_webhook_deliveries
  for select to authenticated using ((select private.is_org_member(organization_id)));

-- Routing logs carry amounts: same gate as every other financial read.
drop policy if exists transaction_routing_logs_org_select on public.transaction_routing_logs;
create policy transaction_routing_logs_org_select on public.transaction_routing_logs
  for select to authenticated using ((select private.has_org_capability(organization_id, 'can_view_values')));

-- crm_channel_delivery_events already has organization_id (CRM organization scope foundation).
drop policy if exists crm_channel_delivery_events_org_select on public.crm_channel_delivery_events;
create policy crm_channel_delivery_events_org_select on public.crm_channel_delivery_events
  for select to authenticated using ((select private.has_org_capability(organization_id, 'can_view_chats')));
