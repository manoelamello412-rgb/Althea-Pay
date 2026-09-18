
create or replace function private.archive_funnel_revenue_source()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
begin
  update public.revenue_sources
  set status='archived',
      metadata=metadata || jsonb_build_object('archived_reason','funnel_deleted'),
      updated_at=now()
  where organization_id=old.organization_id
    and source_type='funnel'
    and source_ref_id=old.id;

  return old;
end;
$function$;

revoke all on function private.archive_funnel_revenue_source() from public,anon,authenticated;

drop trigger if exists trg_archive_funnel_revenue_source on public.funnels;
create trigger trg_archive_funnel_revenue_source
after delete on public.funnels
for each row execute function private.archive_funnel_revenue_source();
