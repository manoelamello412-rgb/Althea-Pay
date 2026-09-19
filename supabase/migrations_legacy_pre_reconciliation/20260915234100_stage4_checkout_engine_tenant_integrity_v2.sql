begin;

create or replace function private.enforce_checkout_child_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare v_org uuid;
begin
  select organization_id into v_org from public.checkout_sessions where id=new.checkout_id;
  if v_org is null then raise exception 'CHECKOUT_NOT_FOUND' using errcode='23503'; end if;
  if new.organization_id is null then new.organization_id:=v_org; end if;
  if new.organization_id <> v_org then raise exception 'CHECKOUT_TENANT_MISMATCH' using errcode='42501'; end if;
  return new;
end;
$function$;

drop trigger if exists trg_checkout_items_tenant on public.checkout_items;
create trigger trg_checkout_items_tenant before insert or update of checkout_id,organization_id on public.checkout_items for each row execute function private.enforce_checkout_child_tenant();
drop trigger if exists trg_checkout_events_tenant on public.checkout_events;
create trigger trg_checkout_events_tenant before insert or update of checkout_id,organization_id on public.checkout_events for each row execute function private.enforce_checkout_child_tenant();

revoke all on function private.enforce_checkout_child_tenant() from public,anon,authenticated;

grant select on table public.checkout_sessions to authenticated;
grant select on table public.checkout_items to authenticated;
grant select on table public.checkout_events to authenticated;

commit;
