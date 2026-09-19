create index if not exists crm_experiment_promotions_experiment_idx on public.crm_experiment_promotions(experiment_id,approved_at desc);
create index if not exists crm_experiment_promotions_variant_idx on public.crm_experiment_promotions(variant_id,approved_at desc);
create index if not exists crm_experiment_promotions_approved_by_idx on public.crm_experiment_promotions(approved_by,approved_at desc);
drop policy if exists crm_channel_delivery_events_select_own on public.crm_channel_delivery_events;
create policy crm_channel_delivery_events_select_own on public.crm_channel_delivery_events for select using(user_id=(select auth.uid()));
drop policy if exists crm_experiment_promotions_owner on public.crm_experiment_promotions;
create policy crm_experiment_promotions_owner on public.crm_experiment_promotions for select using(user_id=(select auth.uid()));
