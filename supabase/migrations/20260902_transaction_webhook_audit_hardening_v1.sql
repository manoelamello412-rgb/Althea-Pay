-- ALTHEA PAY: transactional webhook/audit hardening
create table if not exists public.transaction_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_id uuid,
  event_type text not null,
  idempotency_key text,
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'system',
  status text not null default 'accepted',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_transaction_audit_org_created on public.transaction_audit_events(organization_id, created_at desc);
create unique index if not exists uq_transaction_audit_idempotency on public.transaction_audit_events(organization_id, idempotency_key) where idempotency_key is not null;
alter table public.transaction_audit_events enable row level security;
create policy transaction_audit_events_select_member on public.transaction_audit_events for select to authenticated using (private.is_org_member(organization_id));
create policy transaction_audit_events_insert_member on public.transaction_audit_events for insert to authenticated with check (private.is_org_member(organization_id));
create or replace function public.reserve_transaction_audit_event(p_organization_id uuid,p_event_type text,p_idempotency_key text,p_transaction_id uuid default null,p_source text default 'system',p_metadata jsonb default '{}'::jsonb)
returns table(reserved boolean,audit_event_id uuid) language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_org_member(p_organization_id) then raise exception 'organization_access_denied'; end if;
  if coalesce(length(trim(p_event_type)),0)=0 then raise exception 'event_type_required'; end if;
  if coalesce(length(trim(p_idempotency_key)),0)=0 then raise exception 'idempotency_key_required'; end if;
  insert into public.transaction_audit_events(organization_id,transaction_id,event_type,idempotency_key,actor_user_id,source,metadata)
  values(p_organization_id,p_transaction_id,p_event_type,p_idempotency_key,auth.uid(),coalesce(nullif(trim(p_source),''),'system'),coalesce(p_metadata,'{}'::jsonb))
  on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is not null then return query select true,v_id;
  else return query select false,id from public.transaction_audit_events where organization_id=p_organization_id and idempotency_key=p_idempotency_key limit 1;
  end if;
end;
$$;
revoke all on function public.reserve_transaction_audit_event(uuid,text,text,uuid,text,jsonb) from public;
grant execute on function public.reserve_transaction_audit_event(uuid,text,text,uuid,text,jsonb) to authenticated;
