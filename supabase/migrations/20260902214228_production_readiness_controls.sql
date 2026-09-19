create table if not exists public.platform_health_checks (
  id uuid primary key default gen_random_uuid(),
  check_name text not null unique,
  status text not null check (status in ('pass','warn','fail')),
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
alter table public.platform_health_checks enable row level security;
create index if not exists platform_health_checks_status_idx on public.platform_health_checks(status, checked_at desc);

create or replace function public.record_platform_health_check(p_check_name text, p_status text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_status not in ('pass','warn','fail') then raise exception 'invalid health status'; end if;
  insert into public.platform_health_checks(check_name,status,details,checked_at)
  values(p_check_name,p_status,coalesce(p_details,'{}'::jsonb),now())
  on conflict(check_name) do update set status=excluded.status,details=excluded.details,checked_at=now();
end;
$$;
revoke all on function public.record_platform_health_check(text,text,jsonb) from public;
grant execute on function public.record_platform_health_check(text,text,jsonb) to authenticated;

create table if not exists public.production_readiness_gates (
  gate_name text primary key,
  required boolean not null default true,
  status text not null default 'pending' check(status in ('pending','pass','fail')),
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.production_readiness_gates enable row level security;

insert into public.production_readiness_gates(gate_name,required,status) values
('transaction_state_machine',true,'pass'),
('idempotency',true,'pass'),
('webhook_ingestion',true,'pass'),
('gateway_circuit_breaker',true,'pass'),
('audit_trail',true,'pass'),
('reconciliation',true,'pending'),
('risk_engine',true,'pending'),
('public_api',true,'pending'),
('checkout_e2e',true,'pending'),
('provider_contract_tests',true,'pending'),
('load_tests',true,'pending'),
('security_review',true,'pending')
on conflict(gate_name) do nothing;

create or replace function public.platform_release_ready()
returns boolean language sql stable security definer set search_path=public
as $$
  select not exists(select 1 from public.production_readiness_gates where required and status <> 'pass');
$$;
revoke all on function public.platform_release_ready() from public;
grant execute on function public.platform_release_ready() to authenticated;
