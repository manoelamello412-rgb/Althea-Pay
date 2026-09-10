alter table public.iara_funnel_drafts add column if not exists funnel_id text references public.funnels(id);
create index if not exists iara_funnel_drafts_funnel_idx on public.iara_funnel_drafts(funnel_id);
create table if not exists public.iara_funnel_runtime_specs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  funnel_id text not null references public.funnels(id),
  draft_id uuid not null references public.iara_funnel_drafts(id),
  spec jsonb not null check (jsonb_typeof(spec)='object'),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(funnel_id)
);
alter table public.iara_funnel_runtime_specs enable row level security;
drop policy if exists iara_funnel_runtime_specs_owner_select on public.iara_funnel_runtime_specs;
drop policy if exists iara_funnel_runtime_specs_owner_insert on public.iara_funnel_runtime_specs;
create policy iara_funnel_runtime_specs_owner_select on public.iara_funnel_runtime_specs for select to authenticated using (user_id=auth.uid());
create policy iara_funnel_runtime_specs_owner_insert on public.iara_funnel_runtime_specs for insert to authenticated with check (user_id=auth.uid());
