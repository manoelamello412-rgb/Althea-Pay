-- Audit-log hardening must remain compatible with the canonical audit_logs shape
-- established by 0001_althea_core.sql. Do not introduce a second ownership model.
alter table public.audit_logs enable row level security;
do $$ begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_owner_read'
  ) then
    create policy audit_logs_owner_read
      on public.audit_logs
      for select
      to authenticated
      using (organization_id is not null and public.is_org_member(organization_id));
  end if;
end $$;
create index if not exists audit_logs_org_time_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists audit_logs_resource_idx on public.audit_logs(organization_id, resource_type, resource_id, created_at desc);
comment on table public.audit_logs is 'Security/audit trail. Do not store secrets, PAN, CVC or raw authorization headers.';
