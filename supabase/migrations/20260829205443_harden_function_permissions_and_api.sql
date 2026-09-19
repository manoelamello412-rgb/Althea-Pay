revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists funnels_user_id_idx on public.funnels(user_id);
create index if not exists products_user_id_idx on public.products(user_id);
create index if not exists clients_user_id_idx on public.clients(user_id);
create index if not exists sales_user_id_idx on public.sales(user_id);
create index if not exists gateways_user_id_idx on public.gateways(user_id);
create index if not exists pix_configs_user_id_idx on public.pix_configs(user_id);
create index if not exists pix_history_user_id_idx on public.pix_history(user_id);
create index if not exists chats_user_id_idx on public.chats(user_id);
create index if not exists messages_user_id_idx on public.messages(user_id);
create index if not exists logs_user_id_idx on public.logs(user_id);

alter table public.profiles enable row level security;

create policy "profiles_self_select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_self_update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);