create table if not exists public.iara_commercial_interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  conversation_id uuid not null references public.crm_conversations(id),
  checkout_id uuid references public.checkout_sessions(id),
  control_mode text not null default 'HUMAN' check (control_mode in ('HUMAN','IARA','WAITING')),
  trigger_type text not null check (trigger_type in ('CHECKOUT_STALL','PAYMENT_OBJECTION','CUSTOMER_REQUEST','AFTER_HOURS','MANUAL')),
  state text not null default 'ELIGIBLE' check (state in ('ELIGIBLE','ACTIVE','HANDED_OFF','COMPLETED','CANCELLED')),
  assigned_agent_id uuid references public.crm_agents(id),
  takeover_at timestamptz,
  handed_off_at timestamptz,
  last_customer_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists iara_commercial_interventions_user_idx on public.iara_commercial_interventions(user_id, created_at desc);
create index if not exists iara_commercial_interventions_conversation_idx on public.iara_commercial_interventions(conversation_id, created_at desc);
create unique index if not exists iara_commercial_interventions_active_conversation_idx on public.iara_commercial_interventions(conversation_id) where state in ('ELIGIBLE','ACTIVE');
alter table public.iara_commercial_interventions enable row level security;
drop policy if exists iara_commercial_interventions_owner_select on public.iara_commercial_interventions;
drop policy if exists iara_commercial_interventions_owner_insert on public.iara_commercial_interventions;
drop policy if exists iara_commercial_interventions_owner_update on public.iara_commercial_interventions;
create policy iara_commercial_interventions_owner_select on public.iara_commercial_interventions for select to authenticated using (user_id=auth.uid());
create policy iara_commercial_interventions_owner_insert on public.iara_commercial_interventions for insert to authenticated with check (user_id=auth.uid());
create policy iara_commercial_interventions_owner_update on public.iara_commercial_interventions for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.iara_funnel_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  prompt text not null check (char_length(trim(prompt)) between 1 and 12000),
  status text not null default 'DRAFT' check (status in ('DRAFT','VALIDATED','ACTIVATED','ARCHIVED')),
  schema_version integer not null default 1 check (schema_version > 0),
  spec jsonb not null check (jsonb_typeof(spec)='object'),
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists iara_funnel_drafts_user_idx on public.iara_funnel_drafts(user_id, created_at desc);
alter table public.iara_funnel_drafts enable row level security;
drop policy if exists iara_funnel_drafts_owner_select on public.iara_funnel_drafts;
drop policy if exists iara_funnel_drafts_owner_insert on public.iara_funnel_drafts;
drop policy if exists iara_funnel_drafts_owner_update on public.iara_funnel_drafts;
create policy iara_funnel_drafts_owner_select on public.iara_funnel_drafts for select to authenticated using (user_id=auth.uid());
create policy iara_funnel_drafts_owner_insert on public.iara_funnel_drafts for insert to authenticated with check (user_id=auth.uid());
create policy iara_funnel_drafts_owner_update on public.iara_funnel_drafts for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.iara_daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  report_date date not null,
  report_text text not null,
  metrics jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  delivery_status text not null default 'GENERATED' check (delivery_status in ('GENERATED','QUEUED','DELIVERED','FAILED')),
  generated_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, report_date)
);
alter table public.iara_daily_reports enable row level security;
drop policy if exists iara_daily_reports_owner_select on public.iara_daily_reports;
drop policy if exists iara_daily_reports_owner_insert on public.iara_daily_reports;
drop policy if exists iara_daily_reports_owner_update on public.iara_daily_reports;
create policy iara_daily_reports_owner_select on public.iara_daily_reports for select to authenticated using (user_id=auth.uid());
create policy iara_daily_reports_owner_insert on public.iara_daily_reports for insert to authenticated with check (user_id=auth.uid());
create policy iara_daily_reports_owner_update on public.iara_daily_reports for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create or replace function public.iara_touch_ai_axis_updated_at() returns trigger language plpgsql security definer set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists iara_commercial_interventions_touch on public.iara_commercial_interventions;
create trigger iara_commercial_interventions_touch before update on public.iara_commercial_interventions for each row execute function public.iara_touch_ai_axis_updated_at();
drop trigger if exists iara_funnel_drafts_touch on public.iara_funnel_drafts;
create trigger iara_funnel_drafts_touch before update on public.iara_funnel_drafts for each row execute function public.iara_touch_ai_axis_updated_at();
revoke all on function public.iara_touch_ai_axis_updated_at() from public, anon, authenticated;
grant execute on function public.iara_touch_ai_axis_updated_at() to service_role;
