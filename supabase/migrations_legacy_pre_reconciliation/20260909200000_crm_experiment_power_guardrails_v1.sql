create or replace function public.crm_experiment_sample_size_binary(p_baseline numeric default 0.10,p_mde numeric default 0.03,p_alpha numeric default 0.05,p_power numeric default 0.80)
returns integer language plpgsql immutable as $$
declare z_alpha numeric:=1.95996398454005; z_power numeric:=0.841621233572914; p numeric; n numeric;
begin
 if p_baseline<=0 or p_baseline>=1 or p_mde<=0 or p_alpha<=0 or p_alpha>=1 or p_power<=0 or p_power>=1 then raise exception 'invalid_power_parameters'; end if;
 p:=least(0.999, greatest(0.001,p_baseline));
 n:=((z_alpha*sqrt(2*p*(1-p))+z_power*sqrt(p*(1-p)+(p+p_mde)*(1-p-p_mde)))^2)/(p_mde^2);
 return ceil(n)::integer;
end; $$;

create table if not exists public.crm_experiment_guardrails (
 id uuid primary key default gen_random_uuid(), experiment_id uuid not null references public.crm_experiments(id) on delete cascade,
 metric_name text not null, metric_type text not null check(metric_type in ('conversion','revenue','recovery','custom')),
 min_sample_size integer not null default 100 check(min_sample_size>0), max_regression numeric not null default 0 check(max_regression>=0), enabled boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(experiment_id,metric_name)
);
alter table public.crm_experiment_guardrails enable row level security;
drop policy if exists crm_experiment_guardrails_owner on public.crm_experiment_guardrails;
create policy crm_experiment_guardrails_owner on public.crm_experiment_guardrails for all to authenticated using(experiment_id in(select id from public.crm_experiments where user_id=auth.uid())) with check(experiment_id in(select id from public.crm_experiments where user_id=auth.uid()));
create index if not exists crm_experiment_guardrails_experiment_idx on public.crm_experiment_guardrails(experiment_id,enabled);
