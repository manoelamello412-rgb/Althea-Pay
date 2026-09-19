create index if not exists integration_events_processing_idx on public.integration_events (status, created_at desc);
create index if not exists integration_events_funnel_type_idx on public.integration_events (user_id, funnel_id, event_type, created_at desc);
create index if not exists automation_rules_status_idx on public.automation_rules (user_id, status, updated_at desc);
create index if not exists sales_external_id_idx on public.sales (user_id, external_id) where external_id is not null;

create or replace function public.claim_integration_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  select status into v_status from public.integration_events where id = p_event_id for update;
  if not found then return false; end if;
  if v_status not in ('pending','retry') then return false; end if;
  update public.integration_events set status='processing' where id=p_event_id;
  return true;
end;
$$;
revoke all on function public.claim_integration_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_integration_event(uuid) to service_role;