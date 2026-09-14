alter table public.funnels
  add column if not exists funnel_type text;

update public.funnels
set funnel_type = 'custom'
where funnel_type is null;

alter table public.funnels
  alter column funnel_type set default 'custom';

alter table public.funnels
  alter column funnel_type set not null;

alter table public.funnels
  drop constraint if exists funnels_funnel_type_check;

alter table public.funnels
  add constraint funnels_funnel_type_check
  check (funnel_type in ('sales', 'lead_capture', 'launch', 'product', 'upsell_downsell', 'subscription', 'custom'));

create index if not exists funnels_user_type_idx
  on public.funnels (user_id, funnel_type)
  where deleted_at is null;
