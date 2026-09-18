alter table public.automation_rules add column if not exists organization_id uuid;
alter table public.automation_executions add column if not exists organization_id uuid;
alter table public.automation_execution_attempts add column if not exists organization_id uuid;

update public.automation_rules r
set organization_id=p.default_organization_id
from public.profiles p
where p.id=r.user_id and r.organization_id is null;

update public.automation_executions e
set organization_id=r.organization_id
from public.automation_rules r
where r.id=e.rule_id and e.organization_id is null;

update public.automation_executions e
set organization_id=p.default_organization_id
from public.profiles p
where p.id=e.user_id and e.organization_id is null;

update public.automation_execution_attempts a
set organization_id=e.organization_id
from public.automation_executions e
where e.id=a.execution_id and a.organization_id is null;

do $$
begin
  if exists(select 1 from public.automation_rules where organization_id is null) then
    raise exception 'automation_rules_organization_backfill_failed';
  end if;
  if exists(select 1 from public.automation_executions where organization_id is null) then
    raise exception 'automation_executions_organization_backfill_failed';
  end if;
  if exists(select 1 from public.automation_execution_attempts where organization_id is null) then
    raise exception 'automation_attempts_organization_backfill_failed';
  end if;
end $$;

alter table public.automation_rules alter column organization_id set not null;
alter table public.automation_executions alter column organization_id set not null;
alter table public.automation_execution_attempts alter column organization_id set not null;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='automation_rules_organization_id_fkey') then
    alter table public.automation_rules add constraint automation_rules_organization_id_fkey
      foreign key(organization_id) references public.organizations(id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='automation_executions_organization_id_fkey') then
    alter table public.automation_executions add constraint automation_executions_organization_id_fkey
      foreign key(organization_id) references public.organizations(id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='automation_execution_attempts_organization_id_fkey') then
    alter table public.automation_execution_attempts add constraint automation_execution_attempts_organization_id_fkey
      foreign key(organization_id) references public.organizations(id) on delete cascade;
  end if;
end $$;

drop index if exists public.automation_executions_user_rule_key_uidx;
create unique index if not exists automation_executions_org_rule_key_uidx
  on public.automation_executions(organization_id,rule_id,execution_key);
create index if not exists automation_rules_org_status_updated_idx
  on public.automation_rules(organization_id,status,updated_at desc);
create index if not exists automation_executions_org_status_created_idx
  on public.automation_executions(organization_id,status,created_at desc);
create index if not exists automation_executions_org_rule_created_idx
  on public.automation_executions(organization_id,rule_id,created_at desc);
create index if not exists automation_attempts_org_started_idx
  on public.automation_execution_attempts(organization_id,started_at desc);

alter table public.automation_rules enable row level security;
alter table public.automation_executions enable row level security;
alter table public.automation_execution_attempts enable row level security;

drop policy if exists automation_rules_owner on public.automation_rules;
drop policy if exists automation_rules_select_tenant on public.automation_rules;
drop policy if exists automation_rules_insert_tenant on public.automation_rules;
drop policy if exists automation_rules_update_tenant on public.automation_rules;
drop policy if exists automation_rules_delete_tenant on public.automation_rules;
create policy automation_rules_select_tenant on public.automation_rules for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy automation_rules_insert_tenant on public.automation_rules for insert to authenticated
  with check (user_id=(select auth.uid()) and (select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy automation_rules_update_tenant on public.automation_rules for update to authenticated
  using ((select private.has_org_role(organization_id,array['owner','admin','manager'])))
  with check ((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy automation_rules_delete_tenant on public.automation_rules for delete to authenticated
  using ((select private.has_org_role(organization_id,array['owner','admin'])));

drop policy if exists automation_executions_select_own on public.automation_executions;
drop policy if exists automation_executions_select_tenant on public.automation_executions;
create policy automation_executions_select_tenant on public.automation_executions for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists automation_attempts_insert_own on public.automation_execution_attempts;
drop policy if exists automation_attempts_update_own on public.automation_execution_attempts;
drop policy if exists automation_execution_attempts_owner on public.automation_execution_attempts;
drop policy if exists automation_attempts_select_tenant on public.automation_execution_attempts;
create policy automation_attempts_select_tenant on public.automation_execution_attempts for select to authenticated
  using ((select private.is_org_member(organization_id)));

revoke all on table public.automation_rules from anon;
revoke all on table public.automation_executions from anon;
revoke all on table public.automation_execution_attempts from anon;
revoke insert,update,delete on table public.automation_rules from authenticated;
grant select on table public.automation_rules to authenticated;
revoke insert,update,delete on table public.automation_executions from authenticated;
grant select on table public.automation_executions to authenticated;
revoke insert,update,delete on table public.automation_execution_attempts from authenticated;
grant select on table public.automation_execution_attempts to authenticated;

create or replace function public.crm_audit_automation_attempt()
returns trigger language plpgsql security definer set search_path='public','pg_catalog'
as $function$
declare a uuid;
begin
  if tg_op='INSERT' and new.status='running' then
    if not exists(select 1 from public.automation_execution_attempts where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1)) then
      insert into public.automation_execution_attempts(execution_id,user_id,organization_id,attempt_no,status,started_at,created_at)
      values(new.id,new.user_id,new.organization_id,greatest(coalesce(new.attempt_count,1),1),'running',coalesce(new.started_at,now()),now());
    end if;
  elsif tg_op='UPDATE' and old.status is distinct from new.status then
    if new.status='running' then
      if not exists(select 1 from public.automation_execution_attempts where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1)) then
        insert into public.automation_execution_attempts(execution_id,user_id,organization_id,attempt_no,status,started_at,created_at)
        values(new.id,new.user_id,new.organization_id,greatest(coalesce(new.attempt_count,1),1),'running',coalesce(new.started_at,now()),now());
      end if;
    else
      select id into a from public.automation_execution_attempts
      where execution_id=new.id and attempt_no=greatest(coalesce(new.attempt_count,1),1)
      order by created_at desc limit 1;
      if a is not null then
        update public.automation_execution_attempts
        set status=new.status,
            finished_at=case when new.status in ('completed','failed','dead_letter') then coalesce(new.completed_at,now()) else finished_at end,
            next_retry_at=new.next_retry_at,error_message=new.error_message,output=new.output
        where id=a;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.crm_automation_attempt_audit()
returns trigger language plpgsql security definer set search_path='public','pg_catalog'
as $function$
declare n integer:=greatest(coalesce(new.attempt_count,1),1);
terminal boolean:=new.status in ('completed','failed','dead_letter');
begin
  if tg_op='INSERT' then
    insert into public.automation_execution_attempts(user_id,organization_id,execution_id,attempt_no,status,error_message,started_at,finished_at)
    values(new.user_id,new.organization_id,new.id,n,new.status,new.error_message,coalesce(new.started_at,now()),case when terminal then coalesce(new.completed_at,now()) else null end)
    on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
    return new;
  end if;
  if new.attempt_count is distinct from old.attempt_count and new.attempt_count>old.attempt_count then
    insert into public.automation_execution_attempts(user_id,organization_id,execution_id,attempt_no,status,error_message,started_at,finished_at)
    values(new.user_id,new.organization_id,new.id,n,new.status,new.error_message,coalesce(new.started_at,now()),case when terminal then coalesce(new.completed_at,now()) else null end)
    on conflict(execution_id,attempt_no) do update set status=excluded.status,error_message=excluded.error_message,finished_at=excluded.finished_at;
  else
    update public.automation_execution_attempts
    set status=new.status,error_message=new.error_message,
        finished_at=case when terminal then coalesce(new.completed_at,now()) else finished_at end
    where execution_id=new.id and attempt_no=n;
  end if;
  return new;
end;
$function$;

create or replace function private.fill_automation_rule_organization()
returns trigger language plpgsql security definer set search_path='public','private','pg_catalog'
as $function$
begin
  if new.organization_id is null then
    select default_organization_id into new.organization_id from public.profiles where id=new.user_id;
  end if;
  if new.organization_id is null then raise exception 'automation_rule_organization_required'; end if;
  return new;
end;
$function$;
revoke all on function private.fill_automation_rule_organization() from public,anon,authenticated;
drop trigger if exists trg_fill_automation_rule_organization on public.automation_rules;
create trigger trg_fill_automation_rule_organization
before insert or update of user_id,organization_id on public.automation_rules
for each row execute function private.fill_automation_rule_organization();

create or replace function private.fill_automation_execution_organization()
returns trigger language plpgsql security definer set search_path='public','private','pg_catalog'
as $function$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from public.automation_rules where id=new.rule_id;
  end if;
  if new.organization_id is null then raise exception 'automation_execution_organization_required'; end if;
  return new;
end;
$function$;
revoke all on function private.fill_automation_execution_organization() from public,anon,authenticated;
drop trigger if exists trg_fill_automation_execution_organization on public.automation_executions;
create trigger trg_fill_automation_execution_organization
before insert or update of rule_id,organization_id on public.automation_executions
for each row execute function private.fill_automation_execution_organization();
